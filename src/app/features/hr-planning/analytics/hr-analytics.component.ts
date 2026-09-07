import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HrPlanningStoreService } from '../../../core/services/hr-planning-store.service';
import { ScenarioRepositoryService } from '../../../core/services/scenario-repository.service';
import { YearDocument } from '../../../core/models/scenario.model';

interface YearRow {
  year: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  baseRevenueA: number;
  baseRevenueB: number;
  baseRevenueC: number;
  finalRevenueA: number;
  finalRevenueB: number;
  finalRevenueC: number;
  preferenceMatchRate: number | null;
}

@Component({
  selector: 'app-hr-analytics',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="hr-analytics">
      @if (isLoading()) {
        <div class="loading-row">
          <mat-spinner diameter="28"></mat-spinner>
          <span>年度データを読み込み中...</span>
        </div>
      } @else if (yearRows().length === 0) {
        <mat-card>
          <mat-card-content>
            <p>分析対象の年度データがありません。</p>
          </mat-card-content>
        </mat-card>
      } @else {
        <div class="summary-cards">
          <mat-card class="summary-card">
            <mat-card-header>
              <mat-card-title>分析対象年度範囲</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="metric-value">
                {{ firstYear() }}年度 〜 {{ lastYear() }}年度（全{{ yearRows().length }}カ年）
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card class="summary-card">
            <mat-card-header>
              <mat-card-title>{{ growthCompareMode() === 'initial' ? '累計売上成長額' : '前年度比売上成長額' }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="metric-value" [class.positive]="revenueGrowth() >= 0" [class.negative]="revenueGrowth() < 0">
                {{ revenueGrowth() >= 0 ? '+' : '' }}{{ revenueGrowth() | number: '1.2-2' }} 億円
              </div>
              <mat-chip-set>
                <mat-chip class="compare-toggle-chip" (click)="toggleGrowthCompareMode()">
                  <mat-icon>{{ revenueGrowth() >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
                  {{ growthCompareMode() === 'initial' ? (firstYear() + '年度比 (クリックで前年比)') : '前年度比 (クリックで初年比)' }}
                  <mat-icon class="swap-icon">swap_horiz</mat-icon>
                </mat-chip>
              </mat-chip-set>
            </mat-card-content>
          </mat-card>

          <mat-card class="summary-card">
            <mat-card-header>
              <mat-card-title>{{ growthCompareMode() === 'initial' ? '累計利益成長額' : '前年度比利益成長額' }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="metric-value" [class.positive]="profitGrowth() >= 0" [class.negative]="profitGrowth() < 0">
                {{ profitGrowth() >= 0 ? '+' : '' }}{{ profitGrowth() | number: '1.2-2' }} 億円
              </div>
              <mat-chip-set>
                <mat-chip class="compare-toggle-chip" (click)="toggleGrowthCompareMode()">
                  <mat-icon>{{ profitGrowth() >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
                  {{ growthCompareMode() === 'initial' ? (firstYear() + '年度比 (クリックで前年比)') : '前年度比 (クリックで初年比)' }}
                  <mat-icon class="swap-icon">swap_horiz</mat-icon>
                </mat-chip>
              </mat-chip-set>
            </mat-card-content>
          </mat-card>
        </div>

        <mat-divider></mat-divider>

        <mat-card class="table-card">
          <mat-card-header>
            <mat-card-title>年度別KPI推移比較（ウォーターフォール売上引き継ぎ）</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table mat-table [dataSource]="yearRows()" class="mat-elevation-z1">
              <ng-container matColumnDef="year">
                <th mat-header-cell *matHeaderCellDef>年度</th>
                <td mat-cell *matCellDef="let row">{{ row.year }}年</td>
              </ng-container>

              <ng-container matColumnDef="totalRevenue">
                <th mat-header-cell *matHeaderCellDef>全社売上（億円）</th>
                <td mat-cell *matCellDef="let row">{{ row.totalRevenue | number: '1.2-2' }}</td>
              </ng-container>

              <ng-container matColumnDef="totalCost">
                <th mat-header-cell *matHeaderCellDef>全社コスト（億円）</th>
                <td mat-cell *matCellDef="let row">{{ row.totalCost | number: '1.2-2' }}</td>
              </ng-container>

              <ng-container matColumnDef="totalProfit">
                <th mat-header-cell *matHeaderCellDef>全社利益（億円）</th>
                <td mat-cell *matCellDef="let row">{{ row.totalProfit | number: '1.2-2' }}</td>
              </ng-container>

              <ng-container matColumnDef="baseRevenues">
                <th mat-header-cell *matHeaderCellDef>基準売上（継承値）A/B/C</th>
                <td mat-cell *matCellDef="let row">
                  {{ row.baseRevenueA | number: '1.2-2' }} /
                  {{ row.baseRevenueB | number: '1.2-2' }} /
                  {{ row.baseRevenueC | number: '1.2-2' }}
                </td>
              </ng-container>

              <ng-container matColumnDef="finalRevenues">
                <th mat-header-cell *matHeaderCellDef>最終売上 A/B/C</th>
                <td mat-cell *matCellDef="let row">
                  {{ row.finalRevenueA | number: '1.2-2' }} /
                  {{ row.finalRevenueB | number: '1.2-2' }} /
                  {{ row.finalRevenueC | number: '1.2-2' }}
                </td>
              </ng-container>

              <ng-container matColumnDef="preferenceMatchRate">
                <th mat-header-cell *matHeaderCellDef>希望合致率</th>
                <td mat-cell *matCellDef="let row">
                  @if (row.preferenceMatchRate !== null) {
                    {{ row.preferenceMatchRate | number: '1.1-1' }}%
                  } @else {
                    <span class="no-preference">希望者なし</span>
                  }
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
            </table>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .hr-analytics {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .loading-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px;
      }
      .summary-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
      }
      .metric-value {
        font-size: 1.4rem;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .metric-value.positive {
        color: #2e7d32;
      }
      .metric-value.negative {
        color: #c62828;
      }
      .compare-toggle-chip {
        cursor: pointer;
      }
      .compare-toggle-chip:hover {
        background-color: rgba(0, 0, 0, 0.08);
      }
      .swap-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-left: 4px;
      }
      table {
        width: 100%;
      }
      .no-preference {
        color: rgba(0, 0, 0, 0.38);
      }
    `,
  ],
})
export class HrAnalyticsComponent {
  private readonly hrPlanningStore = inject(HrPlanningStoreService);
  private readonly repository = inject(ScenarioRepositoryService);

  readonly isLoading = signal<boolean>(false);
  readonly yearDocuments = signal<YearDocument[]>([]);

  readonly displayedColumns = [
    'year',
    'totalRevenue',
    'totalCost',
    'totalProfit',
    'baseRevenues',
    'finalRevenues',
    'preferenceMatchRate',
  ];

  readonly yearRows = computed<YearRow[]>(() =>
    this.yearDocuments()
      .filter((doc) => !!doc.results)
      .map((doc) => this.toYearRow(doc))
      .sort((a, b) => a.year - b.year)
  );

  readonly firstYear = computed(() => this.yearRows()[0]?.year ?? 0);
  readonly lastYear = computed(() => this.yearRows()[this.yearRows().length - 1]?.year ?? 0);

  readonly growthCompareMode = signal<'initial' | 'previous'>('initial');

  readonly revenueGrowth = computed(() => {
    const rows = this.yearRows();
    if (rows.length === 0) return 0;
    if (this.growthCompareMode() === 'previous') {
      if (rows.length < 2) return 0;
      return rows[rows.length - 1].totalRevenue - rows[rows.length - 2].totalRevenue;
    }
    return rows[rows.length - 1].totalRevenue - rows[0].totalRevenue;
  });

  toggleGrowthCompareMode(): void {
    this.growthCompareMode.set(this.growthCompareMode() === 'initial' ? 'previous' : 'initial');
  }

  readonly profitGrowth = computed(() => {
    const rows = this.yearRows();
    if (rows.length === 0) return 0;
    if (this.growthCompareMode() === 'previous') {
      if (rows.length < 2) return 0;
      return rows[rows.length - 1].totalProfit - rows[rows.length - 2].totalProfit;
    }
    return rows[rows.length - 1].totalProfit - rows[0].totalProfit;
  });

  constructor() {
    effect(() => {
      const scenario = this.hrPlanningStore.scenario();
      const years = this.hrPlanningStore.availableYears();
      if (!scenario || years.length === 0) {
        this.yearDocuments.set([]);
        return;
      }
      this.loadAllYearDocuments(scenario.id, years);
    });
  }

  private async loadAllYearDocuments(scenarioId: string, years: number[]): Promise<void> {
    this.isLoading.set(true);
    try {
      const docs = await Promise.all(
        years.map((year) => this.repository.getYearDocument(scenarioId, year))
      );
      this.yearDocuments.set(docs.filter((doc): doc is YearDocument => !!doc));
    } finally {
      this.isLoading.set(false);
    }
  }

  private toYearRow(doc: YearDocument): YearRow {
    const results = doc.results!;
    const preferenceTargetEmployees = doc.employees.filter(
      (emp) => emp.preference && emp.preference !== 'NONE'
    ).length;
    const matchedCount = doc.employees.filter(
      (emp) =>
        emp.preference &&
        emp.preference !== 'NONE' &&
        results.department[emp.preference]?.allocatedEmployeeIds.includes(emp.id)
    ).length;

    return {
      year: doc.year,
      totalRevenue: results.summary.totalRevenue,
      totalCost: results.summary.totalCost,
      totalProfit: results.summary.totalProfit,
      baseRevenueA: doc.baseRevenues.A,
      baseRevenueB: doc.baseRevenues.B,
      baseRevenueC: doc.baseRevenues.C,
      finalRevenueA: results.department['A']?.finalRevenue ?? 0,
      finalRevenueB: results.department['B']?.finalRevenue ?? 0,
      finalRevenueC: results.department['C']?.finalRevenue ?? 0,
      preferenceMatchRate:
        preferenceTargetEmployees > 0 ? (matchedCount / preferenceTargetEmployees) * 100 : null,
    };
  }
}
