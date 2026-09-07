import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
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
    FormsModule,
  ],
  templateUrl: './scenario-comparison.component.html',
  styleUrls: ['./scenario-comparison.component.scss'],
})
export class ScenarioComparisonComponent implements OnInit {
  scenarios = signal<ScenarioSummary[]>([]);
  reasonMemos = signal<Record<string, string>>({});
  userNotesMemos = signal<Record<string, string>>({});
  decidedScenarioId = signal<string | null>(null);

  private snackBar = inject(MatSnackBar);

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

  updateMemo(scenarioId: string | undefined, memo: string): void {
    if (!scenarioId) return;
    const memos = { ...this.reasonMemos() };
    memos[scenarioId] = memo;
    this.reasonMemos.set(memos);
  }

  updateUserNote(scenarioId: string | undefined, note: string): void {
    if (!scenarioId) return;
    const notes = { ...this.userNotesMemos() };
    notes[scenarioId] = note;
    this.userNotesMemos.set(notes);
  }

  async decideScenario(scenario: ScenarioSummary): Promise<void> {
    const updatedScenario: ScenarioSummary = {
      ...scenario,
      decisionReason: this.reasonMemos()[scenario.id || ''] ?? scenario.decisionReason ?? '',
      userNotes: this.userNotesMemos()[scenario.id || ''] ?? scenario.userNotes ?? '',
    };

    try {
      // Save to Firestore (with LocalStorage fallback)
      await this.firestoreService.saveScenarioSummary(updatedScenario);

      // Apply scenario data to the store's active state
      this.simulationStore.applyScenario(updatedScenario);

      // Mark scenario as decided
      this.decidedScenarioId.set(scenario.id || null);

      // Show notification using MatSnackBar
      const scenarioName = scenario.name || this.getObjectiveLabel(scenario.objective);
      this.snackBar.open(`シナリオ「${scenarioName}」を決定し、レポートに反映しました`, '✓', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
      });
    } catch (error) {
      console.error('Failed to save decision:', error);
      this.snackBar.open('保存に失敗しました', '閉じる', {
        duration: 5000,
        panelClass: ['error-snackbar'],
      });
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
      totalRevenue: '全社売上最大化',
      departmentAProfitMaximize: 'A事業部利益最大化',
      departmentBRevenueMaximize: 'B事業部売上最大化',
      departmentCRevenueMaximize: 'C事業部売上最大化',
    };
    return labels[objective] || objective;
  }

  getDepartmentData(scenario: ScenarioSummary, deptKey: string) {
    const key = deptKey as 'A' | 'B' | 'C';
    return scenario.departmentSummaries[key];
  }
}
