import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CsvParserService } from './csv-parser.service';
import { ScenarioRepositoryService } from './scenario-repository.service';
import { clearAdditionalEmployeesOnBootOnce } from './simulation-store.service';
import { Scenario, YearDocument, DepartmentRevenues } from '../models/scenario.model';
import {
  Employee,
  AllocationResult,
  DepartmentObjective,
  SatisfactionSecondaryObjective,
} from '../models/simulation.model';
import { DEPARTMENT_CONFIGS } from '../../shared/constants/simulation.constants';

// 評価スコア別の年次成長率（伸びしろ成長方式）
const GROWTH_RATE_BY_SCORE: Record<number, number> = {
  1: -0.02,
  2: 0.0,
  3: 0.025,
  4: 0.05,
  5: 0.08,
};

// 評価スコア別の人件費昇給率
const COST_GROWTH_RATE_BY_SCORE: Record<number, number> = {
  1: -0.02,
  2: 0.0,
  3: 0.03,
  4: 0.045,
  5: 0.06,
};

const PERSONNEL_COST_CAP = 20;
const ADDITIONAL_10_EMPLOYEES_STORAGE_KEY = 'uploaded_additional_10_employees';

const INITIAL_YEAR = 2026;
const INITIAL_BASE_REVENUES: DepartmentRevenues = { A: 10, B: 7, C: 2 };

// 経年タレントマネジメント実務機能（/hr-planning）専用ストア。
// SimulationStoreService（課題1〜4検証用）とは完全に分離し、相互の状態を参照しない。
@Injectable({
  providedIn: 'root',
})
export class HrPlanningStoreService {
  readonly scenario = signal<Scenario | null>(null);
  readonly currentYear = signal<number>(INITIAL_YEAR);
  readonly availableYears = signal<number[]>([]);
  readonly yearDocument = signal<YearDocument | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string>('');
  readonly isDirty = signal<boolean>(false);
  readonly dirtyFromYear = signal<number | null>(null);
  readonly insufficientDataWarning = signal<string>('');

  private httpClient = inject(HttpClient);
  private csvParserService = inject(CsvParserService);
  private repository = inject(ScenarioRepositoryService);

  // 評価目的・年度ごとの計算済みシミュレーション結果キャッシュ（100名・110名を同時保持し、再計算スキップに用いる）
  private resultsCache = new Map<string, { result100: AllocationResult; result110?: AllocationResult }>();
  private workerRequestIdCounter = 0;

  private buildResultsCacheKey(
    year: number,
    objective: DepartmentObjective,
    satisfactionSecondaryObjective?: SatisfactionSecondaryObjective
  ): string {
    return `${year}_${objective}_${satisfactionSecondaryObjective || 'none'}`;
  }

  // 追加10名データがSessionStorageから失われた場合、当該年度のresultsCacheに残る
  // 古い110名結果を道連れで破棄し、updateObjective()等で復元されないようにする。
  private clearStaleResults110CacheForYear(year: number): void {
    const prefix = `${year}_`;
    for (const [key, val] of this.resultsCache) {
      if (key.startsWith(prefix)) {
        this.resultsCache.set(key, { ...val, result110: undefined });
      }
    }
  }

  // 編集された最も古い年度を記憶し、recalculateAllYears()でその年度からのみ再計算できるようにする。
  private markDirtyFromYear(year: number): void {
    const current = this.dirtyFromYear();
    if (current === null || year < current) {
      this.dirtyFromYear.set(year);
    }
    this.isDirty.set(true);
  }

  private growAbility(current: number, rate: number): number {
    return current + (100 - current) * rate;
  }

  // 110名体制の追加10名データを取得（呼び出しごとに複製を返し、参照共有による意図しない書き換えを防止）。
  // 単年側の「社員データ管理」でユーザーがアップロード済みの追加10名データが存在する場合のみそれを返し、
  // 存在しない場合はnullを返す（ダミーデータへのフォールバックは行わない）。
  private getInitialAdditionalEmployees(): Employee[] | null {
    try {
      const raw = sessionStorage.getItem(ADDITIONAL_10_EMPLOYEES_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Employee[];
      if (!Array.isArray(parsed) || parsed.length !== 10) return null;
      return parsed.map((emp) => ({
        ...emp,
        preference: emp.preference ?? 'NONE',
        evaluationScore: emp.evaluationScore ?? 3,
      }));
    } catch (error) {
      console.error('[HrPlanningStore] Failed to load additional 10 employees from SessionStorage:', error);
      return null;
    }
  }

  // 経年タレントマネジメント: 100名結果・110名結果は常にrecalculateYearでバックグラウンド並行計算・保持済みのため、
  // ここではキャッシュ済みシグナルの参照を切り替えるのみで再計算は一切行わない（0ms）。
  async setMemberMode(scenarioId: string, year: number, mode: 100 | 110): Promise<void> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) return;

    if (!this.getInitialAdditionalEmployees()) {
      doc.results110 = undefined;
      doc.additionalEmployees = undefined;
      this.clearStaleResults110CacheForYear(year);
    }

    doc.memberMode = mode;
    await this.repository.saveYearDocument(scenarioId, year, doc);

    if (mode === 110 && !doc.results110) {
      if (this.getInitialAdditionalEmployees()) {
        this.insufficientDataWarning.set(
          '※10名データが更新されました。『全年度再計算』を実行して結果を反映させてください'
        );
        this.isDirty.set(true);
      } else {
        this.insufficientDataWarning.set(
          '※110名用人事データ（追加10名）が読み込まれていないため、100名でのシミュレーション結果を表示しています'
        );
      }
    } else {
      this.insufficientDataWarning.set('');
    }
    this.yearDocument.set({ ...doc });
  }

  // 翌期反映タイムラグモデル: N期のpreviousEmp.evaluationScoreを起点に、
  // N+1期の能力成長・人件費昇給を算出する（advanceToNextYear/runWaterfallRecalculation共通処理）。
  private applyNextYearGrowth(previousEmp: Employee, nextEmp: Employee): Employee {
    const rate = GROWTH_RATE_BY_SCORE[previousEmp.evaluationScore || 3];
    const costRate = COST_GROWTH_RATE_BY_SCORE[previousEmp.evaluationScore || 3];
    return {
      ...nextEmp,
      sales: this.growAbility(previousEmp.sales, rate),
      management: this.growAbility(previousEmp.management, rate),
      development: this.growAbility(previousEmp.development, rate),
      nurture: this.growAbility(previousEmp.nurture, rate),
      personnelCost: Math.min(PERSONNEL_COST_CAP, previousEmp.personnelCost * (1 + costRate)),
    };
  }

  // 2026年度初期データの作成（human_resources_100.csvを参照するのはこの初回のみ）
  async createNewScenario(name: string): Promise<Scenario> {
    this.isLoading.set(true);
    try {
      const csvText = await firstValueFrom(
        this.httpClient.get('/assets/human_resources_100.csv', { responseType: 'text' })
      );
      const parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);
      const employees: Employee[] = parsedEmployees.map((emp) => ({
        ...emp,
        preference: 'NONE',
        evaluationScore: 3,
      }));

      const scenario = await this.repository.createHrScenario(name, INITIAL_YEAR);

      const yearDoc: YearDocument = {
        year: INITIAL_YEAR,
        objective: 'totalRevenue',
        satisfactionSecondaryObjective: 'totalRevenue',
        baseRevenues: { ...INITIAL_BASE_REVENUES },
        employees,
      };
      await this.repository.saveYearDocument(scenario.id, INITIAL_YEAR, yearDoc);

      await this.recalculateYear(scenario.id, INITIAL_YEAR);

      await this.loadScenario(scenario.id);
      this.repository.saveLastActiveScenarioId(scenario.id);
      return scenario;
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadScenario(scenarioId: string): Promise<void> {
    this.isLoading.set(true);
    this.dirtyFromYear.set(null);
    try {
      // シナリオ切替を含むあらゆるロード経路で、SessionStorageの現況とYearDocument/キャッシュの
      // results110を必ず同期させる（loadYear側でも再検証されるが、ここでも明示しておく）。
      if (!this.getInitialAdditionalEmployees()) {
        this.resultsCache.clear();
      }
      const scenario = await this.repository.getHrScenario(scenarioId);
      if (!scenario) {
        this.errorMessage.set('シナリオが見つかりません');
        return;
      }
      this.scenario.set(scenario);
      const years = await this.repository.listYears(scenarioId);
      this.availableYears.set(years);
      await this.loadYear(scenarioId, scenario.currentYear);
      this.repository.saveLastActiveScenarioId(scenarioId);
    } finally {
      this.isLoading.set(false);
    }
  }

  // アプリ起動時の自動復元: LocalStorageの最終アクティブシナリオID → シナリオ一覧の先頭 → 新規作成、の優先順位で復元する。
  async initializeScenario(): Promise<void> {
    // どの画面（単年・経年・データ管理）から先に起動されても、同一ページロード内で
    // 一度だけ追加10名データのSessionStorageを確実に破棄する（リロード時の残留防止）。
    clearAdditionalEmployeesOnBootOnce();

    if (this.scenario()) {
      return;
    }

    const lastActiveId = this.repository.getLastActiveScenarioId();
    if (lastActiveId) {
      const scenario = await this.repository.getHrScenario(lastActiveId);
      if (scenario) {
        await this.loadScenario(lastActiveId);
        return;
      }
    }

    const scenarios = await this.repository.listHrScenarios();
    if (scenarios.length > 0) {
      await this.loadScenario(scenarios[0].id);
      return;
    }

    await this.createNewScenario('デフォルトシナリオ');
  }

  // 経年シナリオ管理画面: シナリオ名の変更（現在読込中のシナリオの場合、シグナルも連動更新する）
  async updateScenarioName(scenarioId: string, name: string): Promise<void> {
    const scenario = await this.repository.getHrScenario(scenarioId);
    if (!scenario) return;

    scenario.name = name;
    await this.repository.updateHrScenario(scenario);

    if (this.scenario()?.id === scenarioId) {
      this.scenario.set({ ...scenario });
    }
  }

  // 経年シナリオ管理画面: シナリオ削除（削除対象が現在読込中のシナリオの場合、状態をクリアする）
  async deleteScenario(scenarioId: string): Promise<void> {
    await this.repository.deleteHrScenario(scenarioId);
    if (this.scenario()?.id === scenarioId) {
      this.scenario.set(null);
      this.currentYear.set(INITIAL_YEAR);
      this.availableYears.set([]);
      this.yearDocument.set(null);
      this.resultsCache.clear();
    }
  }

  async loadYear(scenarioId: string, year: number): Promise<void> {
    this.dirtyFromYear.set(null);
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) {
      this.errorMessage.set(`${year}年度のデータが見つかりません`);
      return;
    }

    if (!this.getInitialAdditionalEmployees()) {
      doc.results110 = undefined;
      doc.additionalEmployees = undefined;
      this.clearStaleResults110CacheForYear(year);
    }

    if (doc.results) {
      const cacheKey = this.buildResultsCacheKey(year, doc.objective, doc.satisfactionSecondaryObjective);
      this.resultsCache.set(cacheKey, { result100: doc.results, result110: doc.results110 });
    }

    this.currentYear.set(year);
    this.yearDocument.set(doc);

    if (doc.memberMode === 110 && !doc.results110) {
      if (this.getInitialAdditionalEmployees()) {
        this.insufficientDataWarning.set(
          '※10名データが更新されました。『全年度再計算』を実行して結果を反映させてください'
        );
        this.isDirty.set(true);
      } else {
        this.insufficientDataWarning.set(
          '※110名用人事データ（追加10名）が読み込まれていないため、100名でのシミュレーション結果を表示しています'
        );
        this.isDirty.set(false);
      }
    } else {
      this.insufficientDataWarning.set('');
      this.isDirty.set(false);
    }
  }

  // 人事カルテUI: 配属希望・評価スコアの編集（編集可能項目はこの2つのみ）
  async updateEmployee(
    scenarioId: string,
    year: number,
    employeeId: string,
    updates: Partial<Pick<Employee, 'preference' | 'evaluationScore'>>
  ): Promise<void> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) return;

    doc.employees = doc.employees.map((emp) =>
      emp.id === employeeId ? { ...emp, ...updates } : emp
    );
    await this.repository.saveYearDocument(scenarioId, year, doc);
    this.yearDocument.set({ ...doc });
    this.markDirtyFromYear(year);
    this.resultsCache.clear();
  }

  // 人事カルテUI: 一括設定（全員一律で配属希望・評価スコアを変更）
  async updateAllEmployees(
    scenarioId: string,
    year: number,
    updates: Partial<Pick<Employee, 'preference' | 'evaluationScore'>>
  ): Promise<void> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) return;

    doc.employees = doc.employees.map((emp) => ({ ...emp, ...updates }));
    await this.repository.saveYearDocument(scenarioId, year, doc);
    this.yearDocument.set({ ...doc });
    this.markDirtyFromYear(year);
    this.resultsCache.clear();
  }

  async updateObjective(
    scenarioId: string,
    year: number,
    objective: DepartmentObjective,
    satisfactionSecondaryObjective?: SatisfactionSecondaryObjective
  ): Promise<void> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) return;

    doc.objective = objective;
    if (satisfactionSecondaryObjective) {
      doc.satisfactionSecondaryObjective = satisfactionSecondaryObjective;
    }

    const cacheKey = this.buildResultsCacheKey(year, doc.objective, doc.satisfactionSecondaryObjective);
    const cachedResults = this.resultsCache.get(cacheKey);

    if (cachedResults) {
      doc.results = cachedResults.result100;
      doc.results110 = cachedResults.result110;
      await this.repository.saveYearDocument(scenarioId, year, doc);
      this.yearDocument.set({ ...doc });
      this.isDirty.set(false);
    } else {
      await this.repository.saveYearDocument(scenarioId, year, doc);
      this.yearDocument.set({ ...doc });
      this.markDirtyFromYear(year);
    }
  }

  // 人事担当者メモ・補足理由の保存（シミュレーション再計算は伴わないためisDirtyは変更しない）
  async updateUserNotes(scenarioId: string, year: number, notes: string): Promise<void> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) return;

    doc.userNotes = notes;
    await this.repository.saveYearDocument(scenarioId, year, doc);
    this.yearDocument.set({ ...doc });
  }

  // 過去年度の変更を受けて、以降の既存年度をウォーターフォール式に自動再計算する。
  // preference/evaluationScoreはユーザー入力済みの値として保持し、再計算の対象外とする。
  private async runWaterfallRecalculation(scenarioId: string, fromYear: number): Promise<void> {
    this.isLoading.set(true);
    try {
      let doc = await this.recalculateYear(scenarioId, fromYear);
      const years = await this.repository.listYears(scenarioId);
      let nextYear = fromYear + 1;

      while (years.includes(nextYear) && doc.results) {
        const nextDoc = await this.repository.getYearDocument(scenarioId, nextYear);
        if (!nextDoc) break;

        nextDoc.baseRevenues = {
          A: doc.results.department['A'].finalRevenue,
          B: doc.results.department['B'].finalRevenue,
          C: doc.results.department['C'].finalRevenue,
        };

        const previousEmployeeById = new Map(doc.employees.map((emp) => [emp.id, emp]));
        nextDoc.employees = nextDoc.employees.map((nextEmp) => {
          const previousEmp = previousEmployeeById.get(nextEmp.id);
          if (!previousEmp) return nextEmp;
          return this.applyNextYearGrowth(previousEmp, nextEmp);
        });

        const previousAdditional = doc.additionalEmployees ?? this.getInitialAdditionalEmployees();
        const nextAdditional = nextDoc.additionalEmployees ?? this.getInitialAdditionalEmployees();
        if (previousAdditional && nextAdditional) {
          const previousAdditionalById = new Map(previousAdditional.map((emp) => [emp.id, emp]));
          nextDoc.additionalEmployees = nextAdditional.map((nextEmp) => {
            const previousEmp = previousAdditionalById.get(nextEmp.id);
            if (!previousEmp) return nextEmp;
            return this.applyNextYearGrowth(previousEmp, nextEmp);
          });
        } else {
          nextDoc.additionalEmployees = undefined;
        }

        await this.repository.saveYearDocument(scenarioId, nextYear, nextDoc);
        doc = await this.recalculateYear(scenarioId, nextYear);
        nextYear++;
      }

      const scenario = this.scenario();
      if (scenario) {
        await this.repository.updateHrScenario(scenario);
      }

      await this.loadYear(scenarioId, this.currentYear());
      this.dirtyFromYear.set(null);
      this.isDirty.set(false);
    } finally {
      this.isLoading.set(false);
    }
  }

  // 最新年度の削除（進行しすぎた年度を巻き戻すための操作）
  async removeLastYear(): Promise<void> {
    const scenario = this.scenario();
    if (!scenario) return;

    const years = this.availableYears();
    if (years.length <= 1) return;

    this.isLoading.set(true);
    try {
      const lastYear = Math.max(...years);
      await this.repository.deleteYearDocument(scenario.id, lastYear);

      const previousYear = lastYear - 1;
      const updatedScenario: Scenario = { ...scenario, currentYear: previousYear };
      await this.repository.updateHrScenario(updatedScenario);
      this.scenario.set(updatedScenario);

      await this.loadYear(scenario.id, previousYear);
      this.availableYears.set(await this.repository.listYears(scenario.id));
    } finally {
      this.isLoading.set(false);
    }
  }

  // 全年度一括再計算（作成済み全年度を初年度から順にウォーターフォール再計算）
  async recalculateAllYears(): Promise<void> {
    const scenario = this.scenario();
    if (!scenario) return;
    const fromYear = this.dirtyFromYear() ?? INITIAL_YEAR;
    await this.runWaterfallRecalculation(scenario.id, fromYear);
  }

  // 次年度への進行（既存であれば表示切替のみ、未作成なら基準売上継承・伸びしろ成長で新規作成）
  async advanceToNextYear(scenarioId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const years = await this.repository.listYears(scenarioId);
      const lastYear = Math.max(...years);
      const nextYear = lastYear + 1;

      if (years.includes(nextYear)) {
        await this.loadYear(scenarioId, nextYear);
        return;
      }

      const lastDoc = await this.recalculateYear(scenarioId, lastYear);
      if (!lastDoc.results) return;

      const nextDoc: YearDocument = {
        year: nextYear,
        objective: lastDoc.objective,
        satisfactionSecondaryObjective: lastDoc.satisfactionSecondaryObjective,
        baseRevenues: {
          A: lastDoc.results.department['A'].finalRevenue,
          B: lastDoc.results.department['B'].finalRevenue,
          C: lastDoc.results.department['C'].finalRevenue,
        },
        employees: lastDoc.employees.map((emp) => this.applyNextYearGrowth(emp, emp)),
        additionalEmployees: (lastDoc.additionalEmployees ?? this.getInitialAdditionalEmployees())?.map((emp) =>
          this.applyNextYearGrowth(emp, emp)
        ),
      };

      await this.repository.saveYearDocument(scenarioId, nextYear, nextDoc);
      await this.recalculateYear(scenarioId, nextYear);

      const scenario = this.scenario();
      if (scenario) {
        const updatedScenario: Scenario = { ...scenario, currentYear: nextYear };
        await this.repository.updateHrScenario(updatedScenario);
        this.scenario.set(updatedScenario);
      }

      this.availableYears.set(await this.repository.listYears(scenarioId));
      await this.loadYear(scenarioId, nextYear);
    } finally {
      this.isLoading.set(false);
    }
  }

  // 指定年度のシミュレーションをWeb Workerで実行する。100名結果・110名（100名+固定追加10名）結果を
  // 常にバックグラウンドで並行計算・保持し、トグル切替（setMemberMode）では再計算を行わない。
  // その年度固有の基準売上（前年度継承値）で最終売上・コスト・利益を再計算した上でYearDocumentへ保存する。
  private async recalculateYear(scenarioId: string, year: number): Promise<YearDocument> {
    const doc = await this.repository.getYearDocument(scenarioId, year);
    if (!doc) {
      throw new Error(`${year}年度のデータが見つかりません`);
    }

    const latestAdditionalEmployees = this.getInitialAdditionalEmployees();
    if (latestAdditionalEmployees) {
      doc.additionalEmployees = latestAdditionalEmployees;
    } else {
      doc.additionalEmployees = undefined;
      doc.results110 = undefined;
    }

    const previousDoc =
      year > INITIAL_YEAR ? await this.repository.getYearDocument(scenarioId, year - 1) : null;

    const additionalEmployees = doc.additionalEmployees;

    const [rawResult100, rawResult110] = await Promise.all([
      this.runSimulationInWorker(doc.employees, doc.objective, 100, doc.satisfactionSecondaryObjective),
      additionalEmployees
        ? this.runSimulationInWorker(
            [...doc.employees, ...additionalEmployees],
            doc.objective,
            110,
            doc.satisfactionSecondaryObjective
          )
        : Promise.resolve(null),
    ]);

    doc.results = this.applyYearBaseRevenues(rawResult100, previousDoc?.results ?? null);
    doc.results110 = rawResult110
      ? this.applyYearBaseRevenues(rawResult110, previousDoc?.results110 ?? null)
      : undefined;
    await this.repository.saveYearDocument(scenarioId, year, doc);

    this.insufficientDataWarning.set(
      !doc.results110
        ? '※110名用人事データ（追加10名）が読み込まれていないため、100名でのシミュレーション結果を表示しています'
        : ''
    );

    const cacheKey = this.buildResultsCacheKey(year, doc.objective, doc.satisfactionSecondaryObjective);
    if (doc.results) {
      this.resultsCache.set(cacheKey, { result100: doc.results, result110: doc.results110 });
    } else {
      this.resultsCache.delete(cacheKey);
    }

    return doc;
  }

  // 1年目（初年度）は simulation.worker.ts の計算式（基準売上 × (1 + 事業部能力値/100 × 成長係数)）を
  // そのまま用いる。2年目以降は前年の事業部最終売上を基準売上として継承し、
  // 当年/前年の事業部能力値比（能力成長倍率）× (1 + 成長係数 × 0.2) を乗算することで、
  // 前年売上をベースとした自然な右肩上がりの成長を再現する（二重乗算を防止）。
  private applyYearBaseRevenues(
    result: AllocationResult,
    previousResult: AllocationResult | null
  ): AllocationResult {
    if (!previousResult) {
      return result;
    }

    const department: AllocationResult['department'] = { ...result.department };
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalCost = 0;

    for (const dept of ['A', 'B', 'C']) {
      const current = result.department[dept];
      const previous = previousResult.department[dept];
      const growthRate = DEPARTMENT_CONFIGS[dept].growthRate;

      const capabilityRatio =
        previous.departmentCapability > 0
          ? current.departmentCapability / previous.departmentCapability
          : 1;

      const baseRevenue = previous.baseRevenue * Math.max(0.1, capabilityRatio) * (1 + growthRate * 0.2);
      const finalRevenue = baseRevenue * (current.shortageCoefficient ?? 1.0) * (current.surplusCoefficient ?? 1.0);
      const profit = finalRevenue - current.cost;

      department[dept] = {
        ...current,
        baseRevenue,
        finalRevenue,
        profit,
      };

      totalRevenue += finalRevenue;
      totalProfit += profit;
      totalCost += current.cost;
    }

    return {
      ...result,
      department,
      summary: {
        ...result.summary,
        totalRevenue,
        totalProfit,
        totalCost,
        isBelowPreviousYearRevenue: totalRevenue < previousResult.summary.totalRevenue,
      },
    };
  }

  private runSimulationInWorker(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    satisfactionSecondaryObjective?: SatisfactionSecondaryObjective
  ): Promise<AllocationResult> {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') {
        reject(new Error('Web Workerが利用できません'));
        return;
      }

      const worker = new Worker(new URL('../../workers/simulation.worker', import.meta.url), {
        type: 'module',
      });
      const requestId = ++this.workerRequestIdCounter;

      worker.addEventListener('message', ({ data }: MessageEvent) => {
        if (data.requestId !== requestId) return;
        worker.terminate();
        if (data.type === 'ERROR') {
          reject(new Error(data.error));
        } else {
          resolve(data.data as AllocationResult);
        }
      });

      worker.addEventListener('error', (error) => {
        worker.terminate();
        reject(error);
      });

      worker.postMessage({
        employees,
        objective,
        totalEmployees,
        satisfactionSecondaryObjective,
        requestId,
      });
    });
  }
}
