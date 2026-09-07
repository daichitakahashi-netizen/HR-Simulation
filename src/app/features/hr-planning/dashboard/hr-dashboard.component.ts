import { Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { HrPlanningStoreService } from '../../../core/services/hr-planning-store.service';
import { AllocationResult, DepartmentObjective, Employee, SatisfactionSecondaryObjective } from '../../../core/models/simulation.model';
import { MemberListDialogComponent } from '../member-list-dialog/member-list-dialog.component';

const PREVIOUS_YEAR_TARGET_REVENUE = 58;

const OBJECTIVE_LABELS: Record<DepartmentObjective, string> = {
  totalRevenue: '全社売上最大化',
  departmentAProfitMaximize: 'A事業部利益最大化',
  departmentBRevenueMaximize: 'B事業部売上最大化',
  departmentCRevenueMaximize: 'C事業部売上最大化',
  employeeSatisfaction: '従業員満足度重視',
};

const TARGET_DEPARTMENT: Partial<Record<DepartmentObjective, 'A' | 'B' | 'C'>> = {
  departmentAProfitMaximize: 'A',
  departmentBRevenueMaximize: 'B',
  departmentCRevenueMaximize: 'C',
};

const SKILL_NAME_MAP: Record<'sales' | 'management' | 'development' | 'nurture', string> = {
  sales: '営業力',
  management: '管理力',
  development: '開拓力',
  nurture: '育成力',
};

const SECONDARY_OBJECTIVE_LABELS: Record<SatisfactionSecondaryObjective, string> = {
  totalRevenue: '全社売上',
  totalProfit: '全社利益',
};

@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatButtonToggleModule,
    MatTabsModule,
    BaseChartDirective,
  ],
  template: `
    <div class="hr-dashboard">
      <div class="left-panel">
        <mat-card class="control-panel">
          <mat-card-header>
            <mat-card-title>評価目的設定</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>評価目的</mat-label>
              <mat-select [ngModel]="objective()" (ngModelChange)="onObjectiveChange($event)">
                @for (key of objectiveKeys; track key) {
                  <mat-option [value]="key">{{ objectiveLabels[key] }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            @if (objective() === 'employeeSatisfaction') {
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>第二評価軸</mat-label>
                <mat-select
                  [ngModel]="secondaryObjective()"
                  (ngModelChange)="onSecondaryObjectiveChange($event)"
                >
                  @for (key of secondaryObjectiveKeys; track key) {
                    <mat-option [value]="key">{{ secondaryObjectiveLabels[key] }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            <div class="member-mode-toggle">
              <span class="member-mode-label">人員体制</span>
              <mat-button-toggle-group
                [value]="memberMode()"
                (change)="onMemberModeChange($event.value)"
              >
                <mat-button-toggle [value]="100">100名 (標準)</mat-button-toggle>
                <mat-button-toggle [value]="110">110名 (追加採用)</mat-button-toggle>
              </mat-button-toggle-group>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="policy-memo-panel">
          <mat-tab-group>
            <mat-tab label="配置方針">
              <div class="tab-content explanation-panel">
                <p class="policy-text">{{ policyText() }}</p>
                <p class="match-text">
                  @if (preferenceTargetCount() === 0) {
                    配属希望一致人数: 希望者なし
                  } @else {
                    配属希望一致人数: {{ preferenceMatchCount() }} / {{ preferenceTargetCount() }} 名
                    （合致率: {{ preferenceMatchRate() | percent: '1.0-1' }}）
                  }
                </p>
              </div>
            </mat-tab>
            <mat-tab label="人事メモ">
              <div class="tab-content memo-panel">
                <mat-form-field appearance="outline" class="w-full" subscriptSizing="dynamic">
                  <textarea
                    matInput
                    [rows]="objective() === 'employeeSatisfaction' ? 4 : 6"
                    placeholder="補足理由・所感を入力"
                    [(ngModel)]="memoText"
                    (ngModelChange)="onMemoTextChange($event)"
                  ></textarea>
                </mat-form-field>
              </div>
            </mat-tab>
          </mat-tab-group>
        </mat-card>
      </div>

      <div class="right-panel">
        <div class="kpi-summary">
          <h2>全社KPIサマリー ({{ currentYear() }}年度)</h2>
          @if (insufficientDataWarning()) {
            <p class="insufficient-data-warning">
              <mat-icon>warning</mat-icon>
              {{ insufficientDataWarning() }}
            </p>
          }
          <div class="kpi-cards">
            <mat-card class="kpi-card">
              <mat-card-content>
                <div class="kpi-label">
                  全社売上
                  @if (isBelowTarget()) {
                    <mat-chip class="warning-badge">
                      <mat-icon>warning</mat-icon>
                      未達
                    </mat-chip>
                  }
                </div>
                <div class="kpi-value">
                  {{ summary()?.totalRevenue | number: '1.2-2' }}
                  <span class="kpi-unit">億円</span>
                </div>
                @if (kpiDifferences(); as diffs) {
                  <div class="diff-indicator">
                    <mat-chip [class]="'diff-chip ' + (diffs.revenueDiff >= 0 ? 'positive' : 'negative')">
                      <span class="delta-symbol">Δ</span>
                      {{ diffs.revenueDiff >= 0 ? '+' : '' }}{{ diffs.revenueDiff | number: '1.2-2' }}
                    </mat-chip>
                  </div>
                }
              </mat-card-content>
            </mat-card>

            <mat-card class="kpi-card">
              <mat-card-content>
                <div class="kpi-label">全社コスト</div>
                <div class="kpi-value">
                  {{ summary()?.totalCost | number: '1.2-2' }}
                  <span class="kpi-unit">億円</span>
                </div>
                @if (kpiDifferences(); as diffs) {
                  <div class="diff-indicator">
                    <mat-chip [class]="'diff-chip ' + (diffs.costDiff <= 0 ? 'positive' : 'negative')">
                      <span class="delta-symbol">Δ</span>
                      {{ diffs.costDiff >= 0 ? '+' : '' }}{{ diffs.costDiff | number: '1.2-2' }}
                    </mat-chip>
                  </div>
                }
              </mat-card-content>
            </mat-card>

            <mat-card class="kpi-card">
              <mat-card-content>
                <div class="kpi-label">全社利益</div>
                <div class="kpi-value">
                  {{ summary()?.totalProfit | number: '1.2-2' }}
                  <span class="kpi-unit">億円</span>
                </div>
                @if (kpiDifferences(); as diffs) {
                  <div class="diff-indicator">
                    <mat-chip [class]="'diff-chip ' + (diffs.profitDiff >= 0 ? 'positive' : 'negative')">
                      <span class="delta-symbol">Δ</span>
                      {{ diffs.profitDiff >= 0 ? '+' : '' }}{{ diffs.profitDiff | number: '1.2-2' }}
                    </mat-chip>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>

          <div class="charts-wrapper">
            <div class="chart-card">
              <h3 class="chart-title">全社売上構成</h3>
              <div class="chart-container">
                <canvas baseChart [type]="donutChartType" [data]="revenueChartData()" [options]="donutChartOptions"></canvas>
              </div>
            </div>
            <div class="chart-card">
              <h3 class="chart-title">全社コスト構成</h3>
              <div class="chart-container">
                <canvas baseChart [type]="donutChartType" [data]="costChartData()" [options]="donutChartOptions"></canvas>
              </div>
            </div>
            <div class="chart-card">
              <h3 class="chart-title">全社利益構成</h3>
              <div class="chart-container">
                <canvas baseChart [type]="donutChartType" [data]="profitChartData()" [options]="donutChartOptions"></canvas>
              </div>
            </div>
          </div>
        </div>

        <div class="department-status">
          <h2>事業部ステータス</h2>
          <div class="department-cards">
            @for (dept of departmentKeys; track dept) {
              <mat-card [class]="'department-card dept-' + dept.toLowerCase()">
                <mat-card-header>
                  <mat-card-title>{{ dept }}事業部</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  @if (departmentResult(dept); as d) {
                    <div class="dept-info">
                      <div class="info-row">
                        <span>配置人数:</span>
                        <strong>
                          {{ d.allocatedEmployees }} 名
                          @if (deptDifferences() && getDeptDifference(dept, 'allocatedDiff') !== 0) {
                            <mat-chip [class]="'mini-diff-chip ' + (getDeptDifference(dept, 'allocatedDiff') > 0 ? 'positive' : 'negative')">
                              {{ getDeptDifference(dept, 'allocatedDiff') > 0 ? '+' : '' }}{{ getDeptDifference(dept, 'allocatedDiff') }}
                            </mat-chip>
                          }
                        </strong>
                      </div>
                      <div class="info-row">
                        <span>事業部能力値:</span>
                        <strong>{{ d.departmentCapability | number: '1.2-2' }}</strong>
                      </div>
                      <div class="info-row">
                        <span>基準売上:</span>
                        <strong>{{ d.baseRevenue | number: '1.2-2' }} 億円</strong>
                      </div>
                      <div class="info-row">
                        <span>充足率:</span>
                        <strong>{{ d.fulfillmentRate | percent: '1.0-1' }}</strong>
                      </div>
                      <div class="info-row">
                        <span>最終売上:</span>
                        <strong>
                          {{ d.finalRevenue | number: '1.2-2' }} 億円
                          @if (deptDifferences() && getDeptDifference(dept, 'revenueDiff') !== 0) {
                            <mat-chip [class]="'mini-diff-chip ' + (getDeptDifference(dept, 'revenueDiff') > 0 ? 'positive' : 'negative')">
                              Δ{{ getDeptDifference(dept, 'revenueDiff') > 0 ? '+' : '' }}{{ getDeptDifference(dept, 'revenueDiff') | number: '1.2-2' }}
                            </mat-chip>
                          }
                        </strong>
                      </div>
                      <div class="info-row">
                        <span>人件費コスト:</span>
                        <strong>{{ d.cost | number: '1.2-2' }} 億円</strong>
                      </div>
                      <div class="info-row">
                        <span>事業部利益:</span>
                        <strong>
                          {{ d.profit | number: '1.2-2' }} 億円
                          @if (deptDifferences() && getDeptDifference(dept, 'profitDiff') !== 0) {
                            <mat-chip [class]="'mini-diff-chip ' + (getDeptDifference(dept, 'profitDiff') > 0 ? 'positive' : 'negative')">
                              Δ{{ getDeptDifference(dept, 'profitDiff') > 0 ? '+' : '' }}{{ getDeptDifference(dept, 'profitDiff') | number: '1.2-2' }}
                            </mat-chip>
                          }
                        </strong>
                      </div>
                    </div>
                    <button
                      mat-stroked-button
                      color="primary"
                      class="w-full"
                      (click)="openMemberList(dept)"
                    >
                      配置メンバー一覧を見る
                    </button>
                  } @else {
                    <p>データがありません。</p>
                  }
                </mat-card-content>
              </mat-card>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hr-dashboard {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 0.4rem;
      padding: 0.3rem 0.5rem;
      height: calc(100vh - 120px);
      overflow: hidden;
      box-sizing: border-box;
      min-width: 0;

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
        height: auto;
        overflow: visible;
      }
    }

    .left-panel {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      overflow: auto;
      max-height: 100%;
      padding-right: 0.25rem;
    }

    .control-panel mat-form-field {
      display: block;
      width: 100%;
      margin-bottom: 12px;
      margin-right: 0;
    }

    .member-mode-toggle {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;

      .member-mode-label {
        font-size: 0.75rem;
        color: #666;
      }

      mat-button-toggle-group {
        width: 100%;
      }

      mat-button-toggle {
        flex: 1;
        font-size: 0.75rem;
      }
    }

    .policy-memo-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;

      mat-tab-group {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .tab-content {
        padding: 0.4rem 0.6rem;
      }

      ::ng-deep {
        .mat-mdc-tab-header {
          flex-shrink: 0;
        }
        .mat-mdc-tab-labels {
          justify-content: center;
        }
        .mat-mdc-tab {
          flex: none;
          min-width: 0;
          padding: 0 0.75rem;
        }
        .mdc-tab__text-label {
          font-size: 0.85rem;
          white-space: nowrap;
          overflow: visible;
        }
      }

      .explanation-panel {
        .policy-text {
          margin: 0 0 0.4rem 0;
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .match-text {
          margin: 0;
          font-size: 0.9rem;
          line-height: 1.45;
          color: #555;
        }
      }

      .memo-panel {
        display: flex;
        flex-direction: column;

        .w-full {
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        textarea {
          resize: none;
          transition: height 0.15s ease;
        }
      }
    }

    .right-panel {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      height: 100%;
      overflow: hidden;
      min-width: 0;
    }

    .kpi-summary {
      flex-shrink: 0;
      h2 { margin: 0 0 0.2rem 0; font-size: 0.9rem; font-weight: 600; }

      .insufficient-data-warning {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin: 0 0 0.35rem 0;
        font-size: 0.72rem;
        font-weight: 600;
        color: #d32f2f;
        mat-icon { font-size: 0.9rem; height: 0.9rem; width: 0.9rem; }
      }

      .kpi-cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.35rem;
        margin-bottom: 0.35rem;
      }

      .kpi-card {
        mat-card-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.3rem !important;
          text-align: center;
        }
        .kpi-label {
          font-size: 0.65rem;
          color: #666;
          margin-bottom: 0.1rem;
          display: flex; align-items: center; gap: 0.2rem;
          .warning-badge {
            background-color: #d32f2f !important;
            color: white !important;
            font-size: 0.55rem;
            padding: 0.1rem 0.3rem;
            mat-icon { font-size: 0.8rem; height: 0.8rem; width: 0.8rem; }
          }
        }
        .kpi-value {
          font-size: 0.95rem;
          font-weight: 700;
          color: #1976d2;
          display: flex; align-items: baseline; gap: 0.15rem;
          .kpi-unit { font-size: 0.65rem; color: #888; font-weight: 400; }
        }
        .diff-indicator { margin-top: 0.1rem; }
        .diff-chip {
          font-size: 0.62rem;
          height: auto;
          padding: 0.1rem 0.3rem;
          color: #fff !important;
          font-weight: 500;
          --mdc-chip-label-text-color: #fff !important;

          &.positive {
            background-color: #4caf50 !important;
            color: #fff !important;
            --mdc-chip-elevated-container-color: #4caf50 !important;
            --mdc-chip-flat-container-color: #4caf50 !important;
          }

          &.negative {
            background-color: #f44336 !important;
            color: #fff !important;
            --mdc-chip-elevated-container-color: #f44336 !important;
            --mdc-chip-flat-container-color: #f44336 !important;
          }
        }
      }

      .charts-wrapper {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.35rem;
      }

      .chart-card {
        background: #fff;
        border-radius: 4px;
        padding: 0.3rem;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        display: flex;
        flex-direction: column;
        min-width: 0;

        .chart-title {
          margin: 0 0 0.15rem 0;
          font-size: 0.75rem;
          font-weight: 600;
          color: #333;
          text-align: center;
        }

        .chart-container {
          position: relative;
          height: 95px;
          width: 100%;
          canvas { max-width: 100%; max-height: 100%; display: block; }
        }
      }
    }

    .department-status {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;

      h2 { margin: 0 0 0.2rem 0; font-size: 0.9rem; font-weight: 600; }

      .department-cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.35rem;
        height: 100%;
        min-width: 0;
      }

      .department-card {
        min-width: 0;
        display: flex;
        flex-direction: column;

        mat-card-header { padding: 0.25rem 0.4rem; flex-shrink: 0; }
        mat-card-title { font-size: 0.85rem; margin: 0; font-weight: 600; }
        mat-card-content {
          padding: 0.25rem 0.4rem 0.4rem 0.4rem !important;
          min-width: 0;
          overflow: hidden;
          flex: 1;
        }

        &.dept-a { border-left: 3px solid #1976d2; mat-card-title { color: #1976d2; } }
        &.dept-b { border-left: 3px solid #4caf50; mat-card-title { color: #4caf50; } }
        &.dept-c { border-left: 3px solid #ff9800; mat-card-title { color: #ff9800; } }
      }

      .dept-info { display: flex; flex-direction: column; gap: 0.05rem; }

      .w-full {
        width: 100%;
        margin-top: 0.3rem;
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.72rem;
        padding: 0.1rem 0;
        border-bottom: 1px solid #f0f0f0;
        span { color: #666; }
        strong { color: #1976d2; font-weight: 600; }
        .mini-diff-chip {
          font-size: 0.62rem;
          height: auto;
          padding: 0.1rem 0.3rem;
          color: #fff !important;
          font-weight: 500;
          margin-left: 0.2rem;
          --mdc-chip-label-text-color: #fff !important;

          &.positive {
            background-color: #4caf50 !important;
            color: #fff !important;
            --mdc-chip-elevated-container-color: #4caf50 !important;
            --mdc-chip-flat-container-color: #4caf50 !important;
          }

          &.negative {
            background-color: #f44336 !important;
            color: #fff !important;
            --mdc-chip-elevated-container-color: #f44336 !important;
            --mdc-chip-flat-container-color: #f44336 !important;
          }
        }
      }
    }

    ::ng-deep {
      .mat-mdc-form-field-subscript-wrapper { display: none !important; }
      .mat-mdc-card { border-radius: 4px !important; }
    }
  `],
})
export class HrDashboardComponent {
  private store = inject(HrPlanningStoreService);
  private dialog = inject(MatDialog);

  memoText = '';

  constructor() {
    effect(() => {
      const doc = this.store.yearDocument();
      this.memoText = doc?.userNotes ?? '';
    });
  }

  readonly previousYearTarget = PREVIOUS_YEAR_TARGET_REVENUE;
  readonly objectiveLabels = OBJECTIVE_LABELS;
  readonly secondaryObjectiveLabels = SECONDARY_OBJECTIVE_LABELS;
  readonly objectiveKeys = Object.keys(OBJECTIVE_LABELS) as DepartmentObjective[];
  readonly secondaryObjectiveKeys = Object.keys(SECONDARY_OBJECTIVE_LABELS) as SatisfactionSecondaryObjective[];
  readonly departmentKeys: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];

  readonly currentYear = this.store.currentYear;
  readonly insufficientDataWarning = this.store.insufficientDataWarning;

  private readonly deptColors = {
    A: '#1976D2',
    B: '#4CAF50',
    C: '#FF9800',
  };

  readonly objective = computed<DepartmentObjective>(
    () => this.store.yearDocument()?.objective ?? 'totalRevenue'
  );

  readonly secondaryObjective = computed<SatisfactionSecondaryObjective>(
    () => this.store.yearDocument()?.satisfactionSecondaryObjective ?? 'totalRevenue'
  );

  readonly memberMode = computed<100 | 110>(
    () => this.store.yearDocument()?.memberMode ?? 100
  );

  // 100名/110名トグルは再計算を伴わず、保持済みの結果・社員データの参照を切り替えるのみ（0ms）。
  // 110名モードでresults110が未計算の場合は画面白紙化を防ぐためresults（100名結果）へフォールバックする。
  readonly activeResults = computed<AllocationResult | undefined>(() => {
    const doc = this.store.yearDocument();
    if (!doc) return undefined;
    return this.memberMode() === 110 ? (doc.results110 ?? doc.results) : doc.results;
  });

  readonly activeEmployees = computed<Employee[]>(() => {
    const doc = this.store.yearDocument();
    if (!doc) return [];
    if (this.memberMode() === 110 && doc.additionalEmployees && doc.additionalEmployees.length > 0) {
      return [...doc.employees, ...doc.additionalEmployees];
    }
    return doc.employees;
  });

  readonly summary = computed(() => this.activeResults()?.summary);

  readonly isBelowTarget = computed(() => {
    const totalRevenue = this.summary()?.totalRevenue;
    return totalRevenue !== undefined && totalRevenue < PREVIOUS_YEAR_TARGET_REVENUE;
  });

  // 110名モードかつ100名・110名双方の結果が揃っている場合のみ全社KPI差分を算出する
  readonly kpiDifferences = computed(() => {
    const doc = this.store.yearDocument();
    if (!doc || this.memberMode() !== 110 || !doc.results || !doc.results110) {
      return null;
    }
    const current = doc.results110;
    const baseline = doc.results;

    const revenueDiff = current.summary.totalRevenue - baseline.summary.totalRevenue;
    const costDiff = current.summary.totalCost - baseline.summary.totalCost;
    const profitDiff = current.summary.totalProfit - baseline.summary.totalProfit;

    return { revenueDiff, costDiff, profitDiff };
  });

  // 事業部ごとの配置人数・最終売上・事業部利益の差分
  readonly deptDifferences = computed(() => {
    const doc = this.store.yearDocument();
    if (!doc || this.memberMode() !== 110 || !doc.results || !doc.results110) {
      return null;
    }
    const current = doc.results110;
    const baseline = doc.results;

    const buildDiff = (dept: 'A' | 'B' | 'C') => ({
      allocatedDiff: current.department[dept].allocatedEmployees - baseline.department[dept].allocatedEmployees,
      revenueDiff: current.department[dept].finalRevenue - baseline.department[dept].finalRevenue,
      profitDiff: current.department[dept].profit - baseline.department[dept].profit,
    });

    return { A: buildDiff('A'), B: buildDiff('B'), C: buildDiff('C') };
  });

  getDeptDifference(dept: 'A' | 'B' | 'C', metric: 'allocatedDiff' | 'revenueDiff' | 'profitDiff'): number {
    const diffs = this.deptDifferences();
    if (!diffs) return 0;
    return diffs[dept][metric];
  }

  readonly policyText = computed(() => {
    const results = this.activeResults();
    if (!results) return '';
    return this.generatePolicyText(results, this.objective(), this.activeEmployees(), this.kpiDifferences());
  });

  readonly totalEmployeeCount = computed(() => this.activeEmployees().length);

  readonly preferenceMatchCount = computed(() => {
    const results = this.activeResults();
    if (!results) return 0;

    const departmentByEmployeeId = new Map<string, string>();
    for (const dept of this.departmentKeys) {
      const deptResult = results.department[dept];
      for (const employeeId of deptResult?.allocatedEmployeeIds ?? []) {
        departmentByEmployeeId.set(employeeId, dept);
      }
    }

    return this.activeEmployees().filter(
      (emp) => emp.preference && emp.preference !== 'NONE' && departmentByEmployeeId.get(emp.id) === emp.preference
    ).length;
  });

  readonly preferenceTargetCount = computed(() =>
    this.activeEmployees().filter((emp) => emp.preference && emp.preference !== 'NONE').length
  );

  readonly preferenceMatchRate = computed(() => {
    const target = this.preferenceTargetCount();
    return target > 0 ? this.preferenceMatchCount() / target : 0;
  });

  donutChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { size: 10 },
          boxWidth: 10,
          padding: 4,
        },
      },
    },
  };

  donutChartType = 'doughnut' as const;

  readonly revenueChartData = computed(() => {
    const results = this.activeResults();
    if (!results) {
      return { labels: [], datasets: [] };
    }
    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: '売上',
          data: [
            results.department['A'].finalRevenue,
            results.department['B'].finalRevenue,
            results.department['C'].finalRevenue,
          ],
          backgroundColor: [this.deptColors.A, this.deptColors.B, this.deptColors.C],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  readonly costChartData = computed(() => {
    const results = this.activeResults();
    if (!results) {
      return { labels: [], datasets: [] };
    }
    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: 'コスト',
          data: [
            results.department['A'].cost,
            results.department['B'].cost,
            results.department['C'].cost,
          ],
          backgroundColor: [this.deptColors.A, this.deptColors.B, this.deptColors.C],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  readonly profitChartData = computed(() => {
    const results = this.activeResults();
    if (!results) {
      return { labels: [], datasets: [] };
    }
    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: '利益',
          data: [
            results.department['A'].profit,
            results.department['B'].profit,
            results.department['C'].profit,
          ],
          backgroundColor: [this.deptColors.A, this.deptColors.B, this.deptColors.C],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  departmentResult(dept: 'A' | 'B' | 'C') {
    return this.activeResults()?.department[dept];
  }

  openMemberList(dept: 'A' | 'B' | 'C'): void {
    const deptResult = this.activeResults()?.department[dept];
    if (!deptResult) return;

    this.dialog.open(MemberListDialogComponent, {
      width: '640px',
      maxWidth: '90vw',
      autoFocus: false,
      data: {
        departmentId: dept,
        departmentLabel: `${dept}事業部`,
        allocatedEmployeeIds: deptResult.allocatedEmployeeIds ?? [],
        employees: this.activeEmployees(),
      },
    });
  }

  onObjectiveChange(objective: DepartmentObjective): void {
    const scenarioId = this.store.scenario()?.id;
    if (!scenarioId) return;
    this.store.updateObjective(scenarioId, this.currentYear(), objective, this.secondaryObjective());
  }

  private generatePolicyText(
    results: AllocationResult,
    objective: DepartmentObjective,
    employees: Employee[],
    kpiDiffs: { revenueDiff: number; costDiff: number; profitDiff: number } | null = null
  ): string {
    const objectiveText = this.objectiveLabels[objective];
    const targetDept = TARGET_DEPARTMENT[objective];

    const departments: Array<{ code: 'A' | 'B' | 'C'; name: string; finalRevenue: number }> =
      this.departmentKeys.map((code) => ({
        code,
        name: `${code}事業部`,
        finalRevenue: results.department[code].finalRevenue,
      }));

    let dominantDept = departments.reduce((prev, curr) =>
      curr.finalRevenue > prev.finalRevenue ? curr : prev
    );
    if (targetDept) {
      dominantDept = departments.find((d) => d.code === targetDept) ?? dominantDept;
    }

    const allocatedIds = results.department[dominantDept.code].allocatedEmployeeIds ?? [];
    const allocatedEmployees = allocatedIds
      .map((id) => employees.find((e) => e.id === id))
      .filter((e): e is Employee => e !== undefined);

    const skillScores = {
      sales: allocatedEmployees.reduce((sum, e) => sum + e.sales, 0) / Math.max(allocatedEmployees.length, 1),
      management: allocatedEmployees.reduce((sum, e) => sum + e.management, 0) / Math.max(allocatedEmployees.length, 1),
      development: allocatedEmployees.reduce((sum, e) => sum + e.development, 0) / Math.max(allocatedEmployees.length, 1),
      nurture: allocatedEmployees.reduce((sum, e) => sum + e.nurture, 0) / Math.max(allocatedEmployees.length, 1),
    };
    const dominantSkill = (Object.entries(skillScores) as Array<[keyof typeof skillScores, number]>).reduce(
      (prev, curr) => (curr[1] > prev[1] ? curr : prev)
    );

    const totalRevenue = results.summary.totalRevenue.toFixed(2);
    const totalProfit = results.summary.totalProfit.toFixed(2);

    let text =
      `【${objectiveText}】を実現するため、${dominantDept.name}を中心に配置しました。` +
      `${dominantDept.name}には${SKILL_NAME_MAP[dominantSkill[0]]}に優れた人材を集約し、最大の売上向上効果を実現しています。` +
      `最適配置により、全社売上${totalRevenue}億円、全社利益${totalProfit}億円を実現しました。`;

    if (kpiDiffs) {
      const revenueDiffText = `${kpiDiffs.revenueDiff >= 0 ? '+' : ''}${kpiDiffs.revenueDiff.toFixed(2)}`;
      const profitDiffText = `${kpiDiffs.profitDiff >= 0 ? '+' : ''}${kpiDiffs.profitDiff.toFixed(2)}`;
      text += `100名体制との比較では、全社売上${totalRevenue}億円（Δ${revenueDiffText}億円）、全社利益${totalProfit}億円（Δ${profitDiffText}億円）の向上を実現しました。`;
    }

    return text;
  }

  onSecondaryObjectiveChange(secondaryObjective: SatisfactionSecondaryObjective): void {
    const scenarioId = this.store.scenario()?.id;
    if (!scenarioId) return;
    this.store.updateObjective(scenarioId, this.currentYear(), this.objective(), secondaryObjective);
  }

  onMemberModeChange(mode: 100 | 110): void {
    const scenarioId = this.store.scenario()?.id;
    if (!scenarioId) return;
    this.store.setMemberMode(scenarioId, this.currentYear(), mode);
  }

  onMemoTextChange(notes: string): void {
    const scenarioId = this.store.scenario()?.id;
    if (!scenarioId) return;
    this.store.updateUserNotes(scenarioId, this.currentYear(), notes);
  }
}
