import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HrPlanningStoreService } from '../../../core/services/hr-planning-store.service';
import { Employee } from '../../../core/models/simulation.model';

// 評価スコア別の年次成長率（HrPlanningStoreServiceと同一の値を使用）
const GROWTH_RATE_BY_SCORE: Record<number, number> = {
  1: 0.0,
  2: 0.005,
  3: 0.01,
  4: 0.02,
  5: 0.03,
};

interface KarteRow extends Employee {
  displayName: string;
  previewSales: number;
  previewManagement: number;
  previewDevelopment: number;
  previewNurture: number;
}

const KARTE_SESSION_STORAGE_KEY_PREFIX = 'hr_karte_saved_employees_';

@Component({
  selector: 'app-hr-karte',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    MatFormFieldModule,
    MatSnackBarModule,
  ],
  template: `
    <mat-card>
      <mat-card-header>
        <mat-card-title>人事カルテ</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <mat-toolbar class="karte-toolbar">
          <button mat-stroked-button (click)="setAllPreferenceNone()">
            <mat-icon>clear_all</mat-icon>
            全員「希望なし」に設定
          </button>
          <button mat-stroked-button (click)="setAllEvaluationStandard()">
            <mat-icon>equalizer</mat-icon>
            全員評価「3(標準)」に設定
          </button>
          <button mat-stroked-button (click)="saveChanges()">
            <mat-icon>save</mat-icon>
            変更結果を保存
          </button>
        </mat-toolbar>

        <p class="karte-note">
          ※配属希望や評価スコアを変更した後は、上部の「全年度再計算」ボタンを押してシミュレーション結果に反映させてください。<br />
          ※配属希望は「従業員満足度重視」モードや合致率KPIに反映されます。全社売上最大化モード等では能力値が優先されるため配置が変わらない場合があります。
        </p>

        <div class="karte-table-container">
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="id">
              <th mat-header-cell *matHeaderCellDef>社員ID</th>
              <td mat-cell *matCellDef="let row">{{ row.id }}</td>
            </ng-container>

            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>氏名</th>
              <td mat-cell *matCellDef="let row">{{ row.displayName }}</td>
            </ng-container>

            <ng-container matColumnDef="preference">
              <th mat-header-cell *matHeaderCellDef>配属希望</th>
              <td mat-cell *matCellDef="let row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-select
                    [value]="row.preference || 'NONE'"
                    (selectionChange)="updatePreference(row.id, $event.value)"
                  >
                    <mat-option value="A">A</mat-option>
                    <mat-option value="B">B</mat-option>
                    <mat-option value="C">C</mat-option>
                    <mat-option value="NONE">NONE</mat-option>
                  </mat-select>
                </mat-form-field>
              </td>
            </ng-container>

            <ng-container matColumnDef="evaluationScore">
              <th mat-header-cell *matHeaderCellDef>評価スコア</th>
              <td mat-cell *matCellDef="let row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-select
                    [value]="row.evaluationScore || 3"
                    (selectionChange)="updateEvaluationScore(row.id, $event.value)"
                  >
                    <mat-option [value]="1">1</mat-option>
                    <mat-option [value]="2">2</mat-option>
                    <mat-option [value]="3">3</mat-option>
                    <mat-option [value]="4">4</mat-option>
                    <mat-option [value]="5">5</mat-option>
                  </mat-select>
                </mat-form-field>
              </td>
            </ng-container>

            <ng-container matColumnDef="sales">
              <th mat-header-cell *matHeaderCellDef>営業(前年)</th>
              <td mat-cell *matCellDef="let row">{{ row.sales | number: '1.0-1' }}</td>
            </ng-container>

            <ng-container matColumnDef="management">
              <th mat-header-cell *matHeaderCellDef>管理(前年)</th>
              <td mat-cell *matCellDef="let row">{{ row.management | number: '1.0-1' }}</td>
            </ng-container>

            <ng-container matColumnDef="development">
              <th mat-header-cell *matHeaderCellDef>開拓(前年)</th>
              <td mat-cell *matCellDef="let row">{{ row.development | number: '1.0-1' }}</td>
            </ng-container>

            <ng-container matColumnDef="nurture">
              <th mat-header-cell *matHeaderCellDef>育成(前年)</th>
              <td mat-cell *matCellDef="let row">{{ row.nurture | number: '1.0-1' }}</td>
            </ng-container>

            <ng-container matColumnDef="previewAverage">
              <th mat-header-cell *matHeaderCellDef>成長後能力プレビュー(次年・平均)</th>
              <td mat-cell *matCellDef="let row">
                {{ averagePreview(row) | number: '1.0-1' }}
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
          </table>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .karte-toolbar {
        gap: 8px;
        margin-bottom: 12px;
        background: transparent;
        padding: 0;
      }

      .karte-note {
        font-size: 0.8rem;
        color: #666;
        margin: 0 0 12px;
      }

      .karte-table-container {
        height: calc(100vh - 280px);
        overflow: auto;
      }

      table {
        width: 100%;
      }

      mat-form-field {
        width: 90px;
      }
    `,
  ],
})
export class HrKarteComponent {
  private store = inject(HrPlanningStoreService);
  private snackBar = inject(MatSnackBar);

  readonly displayedColumns = [
    'id',
    'name',
    'preference',
    'evaluationScore',
    'sales',
    'management',
    'development',
    'nurture',
    'previewAverage',
  ];

  readonly rows = computed<KarteRow[]>(() => {
    const doc = this.store.yearDocument();
    if (!doc) return [];
    return doc.employees.map((emp) => {
      const rate = GROWTH_RATE_BY_SCORE[emp.evaluationScore || 3];
      return {
        ...emp,
        displayName: (emp as Employee & { name?: string }).name || emp.id,
        previewSales: this.growAbility(emp.sales, rate),
        previewManagement: this.growAbility(emp.management, rate),
        previewDevelopment: this.growAbility(emp.development, rate),
        previewNurture: this.growAbility(emp.nurture, rate),
      };
    });
  });

  private growAbility(current: number, rate: number): number {
    return current + (100 - current) * rate;
  }

  averagePreview(row: KarteRow): number {
    return (
      (row.previewSales + row.previewManagement + row.previewDevelopment + row.previewNurture) / 4
    );
  }

  updatePreference(employeeId: string, preference: Employee['preference']): void {
    const scenario = this.store.scenario();
    if (!scenario) return;
    void this.store.updateEmployee(scenario.id, this.store.currentYear(), employeeId, {
      preference,
    });
  }

  updateEvaluationScore(employeeId: string, evaluationScore: Employee['evaluationScore']): void {
    const scenario = this.store.scenario();
    if (!scenario) return;
    void this.store.updateEmployee(scenario.id, this.store.currentYear(), employeeId, {
      evaluationScore,
    });
  }

  setAllPreferenceNone(): void {
    const scenario = this.store.scenario();
    if (!scenario) return;
    void this.store.updateAllEmployees(scenario.id, this.store.currentYear(), {
      preference: 'NONE',
    });
  }

  setAllEvaluationStandard(): void {
    const scenario = this.store.scenario();
    if (!scenario) return;
    void this.store.updateAllEmployees(scenario.id, this.store.currentYear(), {
      evaluationScore: 3,
    });
  }

  saveChanges(): void {
    const scenario = this.store.scenario();
    const doc = this.store.yearDocument();
    if (!scenario || !doc) return;

    try {
      sessionStorage.setItem(
        `${KARTE_SESSION_STORAGE_KEY_PREFIX}${scenario.id}_${doc.year}`,
        JSON.stringify(doc.employees)
      );
    } catch (error) {
      console.error('[HrKarte] Failed to save employees to SessionStorage:', error);
    }

    this.snackBar.open('変更を保存しました', '✓', { duration: 3000 });
  }
}
