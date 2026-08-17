import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { FirestoreService } from '../../core/services/firestore.service';
import { ScenarioSummary } from '../../core/models/scenario.model';

@Component({
  selector: 'app-scenario-comparison',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FormsModule,
  ],
  templateUrl: './scenario-comparison.component.html',
  styleUrls: ['./scenario-comparison.component.scss'],
})
export class ScenarioComparisonComponent implements OnInit {
  scenarios = signal<ScenarioSummary[]>([]);
  isSaving = signal(false);
  reasonMemos = signal<Record<string, string>>({});

  readonly simResult = computed(() => this.simulationStore.simulationResult());
  readonly objective = computed(() => this.simulationStore.selectedObjective());
  readonly reasonText = computed(() => this.simulationStore.reasonText());

  constructor(
    private simulationStore: SimulationStoreService,
    private firestoreService: FirestoreService
  ) {}

  ngOnInit(): void {
    this.loadScenarios();
  }

  async loadScenarios(): Promise<void> {
    try {
      const loaded = await this.firestoreService.getScenarioSummaries();
      this.scenarios.set(loaded);
    } catch (error) {
      console.error('Failed to load scenarios:', error);
    }
  }

  async saveCurrentAsScenario(): Promise<void> {
    const result = this.simResult();
    if (!result) {
      return;
    }

    this.isSaving.set(true);
    try {
      const scenario: ScenarioSummary = {
        objective: this.objective(),
        totalRevenue: result.summary.totalRevenue,
        totalCost: result.summary.totalCost,
        totalProfit: result.summary.totalProfit,
        departmentSummaries: {
          A: {
            allocatedEmployees: result.department['A'].allocatedEmployees,
            departmentCapability: result.department['A'].departmentCapability,
            fulfillmentRate: result.department['A'].fulfillmentRate,
            finalRevenue: result.department['A'].finalRevenue,
            cost: result.department['A'].cost,
            profit: result.department['A'].profit,
          },
          B: {
            allocatedEmployees: result.department['B'].allocatedEmployees,
            departmentCapability: result.department['B'].departmentCapability,
            fulfillmentRate: result.department['B'].fulfillmentRate,
            finalRevenue: result.department['B'].finalRevenue,
            cost: result.department['B'].cost,
            profit: result.department['B'].profit,
          },
          C: {
            allocatedEmployees: result.department['C'].allocatedEmployees,
            departmentCapability: result.department['C'].departmentCapability,
            fulfillmentRate: result.department['C'].fulfillmentRate,
            finalRevenue: result.department['C'].finalRevenue,
            cost: result.department['C'].cost,
            profit: result.department['C'].profit,
          },
        },
        decisionReason: this.reasonText(),
      };

      // Save to Firestore (with LocalStorage fallback)
      await this.firestoreService.saveScenarioSummary(scenario);
      await this.loadScenarios();
    } catch (error) {
      console.error('Failed to save scenario:', error);
    } finally {
      this.isSaving.set(false);
    }
  }

  updateMemo(scenarioId: string | undefined, memo: string): void {
    if (!scenarioId) return;
    const memos = { ...this.reasonMemos() };
    memos[scenarioId] = memo;
    this.reasonMemos.set(memos);
  }

  async decideScenario(scenario: ScenarioSummary): Promise<void> {
    const updatedScenario: ScenarioSummary = {
      ...scenario,
      decisionReason: this.reasonMemos()[scenario.id || ''] || scenario.decisionReason,
    };

    try {
      // Save to Firestore (with LocalStorage fallback)
      await this.firestoreService.saveScenarioSummary(updatedScenario);
      alert('シナリオが決定・保存されました');
    } catch (error) {
      console.error('Failed to save decision:', error);
      alert('保存に失敗しました');
    }
  }

  async deleteScenario(id: string | undefined): Promise<void> {
    if (!id || !confirm('このシナリオを削除しますか？')) {
      return;
    }

    try {
      await this.firestoreService.deleteScenarioSummary(id);
      await this.loadScenarios();
    } catch (error) {
      console.error('Failed to delete scenario:', error);
    }
  }

  getObjectiveLabel(objective: string): string {
    const labels: Record<string, string> = {
      total_revenue: '全社売上最大化',
      a_profit: 'A事業部利益最大化',
      b_revenue: 'B事業部売上最大化',
      c_revenue: 'C事業部売上最大化',
    };
    return labels[objective] || objective;
  }

  getDepartmentData(scenario: ScenarioSummary, deptKey: string) {
    const key = deptKey as 'A' | 'B' | 'C';
    return scenario.departmentSummaries[key];
  }
}
