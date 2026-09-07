import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { FormsModule } from '@angular/forms';
import { HrPlanningStoreService } from '../../../core/services/hr-planning-store.service';
import { ScenarioRepositoryService } from '../../../core/services/scenario-repository.service';
import { Scenario, YearDocument } from '../../../core/models/scenario.model';
import { DepartmentObjective } from '../../../core/models/simulation.model';

const OBJECTIVE_LABELS: Record<DepartmentObjective, string> = {
  totalRevenue: '全社売上最大化',
  employeeSatisfaction: '従業員満足度重視',
  departmentAProfitMaximize: 'A事業部利益最大化',
  departmentBRevenueMaximize: 'B事業部売上最大化',
  departmentCRevenueMaximize: 'C事業部売上最大化',
};

interface HrScenarioCard {
  scenario: Scenario;
  years: YearDocument[];
}

@Component({
  selector: 'app-hr-scenario-list',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    FormsModule,
  ],
  template: `
    <div class="hr-scenario-container">
      <mat-card class="create-card">
        <mat-card-content>
          <div class="create-form">
            <mat-form-field class="full-width">
              <mat-label>新規経年シナリオ名</mat-label>
              <input
                matInput
                [(ngModel)]="newScenarioName"
                placeholder="例: 2026年度 積極成長シナリオ"
                [disabled]="isCreating()"
              />
            </mat-form-field>
            <button
              mat-flat-button
              color="primary"
              class="create-button"
              [disabled]="!newScenarioName.trim() || isCreating()"
              (click)="createScenario()"
            >
              <mat-icon>add</mat-icon>
              新規経年シナリオ作成
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      <div class="scenarios-grid">
        <div *ngIf="scenarioCards().length === 0" class="empty-state">
          <mat-card>
            <mat-card-content>
              <p>作成済みの経年シナリオはありません。</p>
            </mat-card-content>
          </mat-card>
        </div>

        <mat-card *ngFor="let card of scenarioCards()" class="scenario-card">
          <mat-card-header>
            <div class="title-row">
              <mat-card-title>{{ card.scenario.name }}</mat-card-title>
              <button mat-icon-button (click)="renameScenario(card.scenario)" aria-label="シナリオ名を編集">
                <mat-icon>edit</mat-icon>
              </button>
            </div>
            <mat-card-subtitle>
              {{ getYearRangeLabel(card.years) }}
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            <div class="years-list">
              <div class="year-row" *ngFor="let year of card.years">
                <div class="year-header">
                  <mat-chip-set>
                    <mat-chip>{{ year.year }}年度</mat-chip>
                    <mat-chip class="objective-chip">{{ getObjectiveLabel(year.objective) }}</mat-chip>
                  </mat-chip-set>
                  <div class="year-kpi" *ngIf="year.results">
                    <span class="kpi-item">
                      <span class="kpi-label">全社売上</span>
                      <span class="kpi-value">{{ year.results.summary.totalRevenue.toFixed(2) }}億円</span>
                    </span>
                    <span class="kpi-item">
                      <span class="kpi-label">全社利益</span>
                      <span class="kpi-value profit">{{ year.results.summary.totalProfit.toFixed(2) }}億円</span>
                    </span>
                  </div>
                </div>
                <p class="notes-preview" *ngIf="year.userNotes">{{ year.userNotes }}</p>
              </div>
            </div>
          </mat-card-content>

          <mat-card-actions>
            <button mat-button color="primary" (click)="openScenario(card.scenario.id)">
              <mat-icon>folder_open</mat-icon>
              このシナリオを開く
            </button>
            <button mat-button color="warn" (click)="deleteScenario(card.scenario.id)">
              <mat-icon>delete</mat-icon>
              削除
            </button>
          </mat-card-actions>
        </mat-card>
      </div>
    </div>
  `,
  styles: [
    `
      .hr-scenario-container {
        padding: 20px;
        max-width: 1400px;
        margin: 0 auto;
      }

      .create-card {
        margin-bottom: 24px;
      }

      .create-form {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .full-width {
        flex: 1;
      }

      .create-button {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }

      .scenarios-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 20px;
      }

      .empty-state {
        grid-column: 1 / -1;
        text-align: center;

        mat-card {
          background-color: rgba(0, 0, 0, 0.02);
          padding: 40px 20px;
        }

        p {
          margin: 0;
          color: rgba(0, 0, 0, 0.6);
        }
      }

      .title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        flex-wrap: nowrap;
        margin-bottom: 2px;

        mat-card-title {
          margin: 0;
          font-size: 16px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        button {
          flex-shrink: 0;
        }
      }

      mat-card-header {
        display: block;
        padding-bottom: 4px;
      }

      .scenario-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        transition: box-shadow 0.3s ease;

        &:hover {
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }

        mat-card-content {
          flex: 1;
        }

        mat-card-actions {
          display: flex;
          gap: 8px;
          padding-top: 16px;
          border-top: 1px solid rgba(0, 0, 0, 0.12);

          button {
            flex: 1;
          }
        }
      }

      .years-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .year-row {
        padding: 6px 10px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        background-color: rgba(0, 0, 0, 0.02);
      }

      .year-header {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;

        ::ng-deep mat-chip-set .mdc-evolution-chip {
          height: 22px;
        }

        ::ng-deep mat-chip-set .mdc-evolution-chip__action--primary {
          padding: 0 8px;
        }

        ::ng-deep mat-chip-set .mdc-evolution-chip-set__chips {
          gap: 6px;
        }
      }

      .objective-chip {
        font-size: 11px;
        background-color: rgba(25, 118, 210, 0.1) !important;
        color: #1976d2 !important;
      }

      .year-kpi {
        display: flex;
        gap: 12px;
        margin-left: auto;
      }

      .kpi-item {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        gap: 4px;

        .kpi-label {
          font-size: 10px;
          line-height: 1;
          color: rgba(0, 0, 0, 0.6);
        }

        .kpi-value {
          font-size: 12px;
          line-height: 1;
          font-weight: 600;
          color: #1976d2;

          &.profit {
            color: #388e3c;
          }
        }
      }

      .notes-preview {
        margin: 4px 0 0;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.7);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    `,
  ],
})
export class HrScenarioListComponent implements OnInit {
  newScenarioName = '';
  scenarioCards = signal<HrScenarioCard[]>([]);
  isCreating = signal(false);

  private router = inject(Router);
  private store = inject(HrPlanningStoreService);
  private repository = inject(ScenarioRepositoryService);

  ngOnInit(): void {
    this.loadScenarios();
  }

  async loadScenarios(): Promise<void> {
    const scenarios = await this.repository.listHrScenarios();
    const cards: HrScenarioCard[] = [];

    for (const scenario of scenarios) {
      const years = await this.repository.listYears(scenario.id);
      const yearDocs: YearDocument[] = [];
      for (const year of years) {
        const doc = await this.repository.getYearDocument(scenario.id, year);
        if (doc) yearDocs.push(doc);
      }
      cards.push({ scenario, years: yearDocs });
    }

    cards.sort((a, b) => b.scenario.createdAt - a.scenario.createdAt);
    this.scenarioCards.set(cards);
  }

  getObjectiveLabel(objective: DepartmentObjective): string {
    return OBJECTIVE_LABELS[objective] ?? objective;
  }

  getYearRangeLabel(years: YearDocument[]): string {
    if (years.length === 0) return '年度データなし';
    const yearNumbers = years.map((y) => y.year);
    const min = Math.min(...yearNumbers);
    const max = Math.max(...yearNumbers);
    return min === max ? `${min}年` : `${min}年〜${max}年`;
  }

  async createScenario(): Promise<void> {
    const name = this.newScenarioName.trim();
    if (!name) return;

    this.isCreating.set(true);
    try {
      const scenario = await this.store.createNewScenario(name);
      this.newScenarioName = '';
      this.router.navigate(['/hr-planning/dashboard']);
    } finally {
      this.isCreating.set(false);
    }
  }

  async openScenario(scenarioId: string): Promise<void> {
    await this.store.loadScenario(scenarioId);
    this.router.navigate(['/hr-planning/dashboard']);
  }

  async deleteScenario(scenarioId: string): Promise<void> {
    if (!confirm('この経年シナリオを削除しますか？')) return;
    await this.store.deleteScenario(scenarioId);
    await this.loadScenarios();
  }

  async renameScenario(scenario: Scenario): Promise<void> {
    const newName = window.prompt('新しいシナリオ名を入力してください', scenario.name);
    if (newName === null) return;

    const trimmed = newName.trim();
    if (!trimmed) return;

    await this.store.updateScenarioName(scenario.id, trimmed);
    await this.loadScenarios();
  }
}
