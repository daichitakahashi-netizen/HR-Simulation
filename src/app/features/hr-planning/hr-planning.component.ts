import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HrPlanningStoreService } from '../../core/services/hr-planning-store.service';

// 経年タレントマネジメント実務機能（/hr-planning）のエントリコンポーネント（親シェル）。
// SimulationStoreService（課題1〜4検証用）は一切参照しない（3重の隔離壁）。
@Component({
  selector: 'app-hr-planning',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './hr-planning.component.html',
  styleUrl: './hr-planning.component.scss',
})
export class HrPlanningComponent implements OnInit {
  readonly store = inject(HrPlanningStoreService);

  async ngOnInit(): Promise<void> {
    await this.store.initializeScenario();
  }

  async createScenario(): Promise<void> {
    const scenario = await this.store.createNewScenario('デフォルトシナリオ');
    await this.store.loadScenario(scenario.id);
  }

  async advanceYear(): Promise<void> {
    const scenario = this.store.scenario();
    if (scenario) {
      await this.store.advanceToNextYear(scenario.id);
    }
  }

  async onYearChange(year: number): Promise<void> {
    const scenario = this.store.scenario();
    if (scenario) {
      await this.store.loadYear(scenario.id, year);
    }
  }

  async recalculateAll(): Promise<void> {
    await this.store.recalculateAllYears();
  }

  async removeYear(): Promise<void> {
    await this.store.removeLastYear();
  }
}
