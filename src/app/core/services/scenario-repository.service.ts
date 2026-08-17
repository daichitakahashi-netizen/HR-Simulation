import { Injectable } from '@angular/core';
import { ScenarioSummary } from '../models/scenario.model';

@Injectable({
  providedIn: 'root',
})
export class ScenarioRepositoryService {
  private readonly STORAGE_KEY = 'hr_simulation_scenarios';

  constructor() {}

  async saveScenario(scenario: ScenarioSummary): Promise<string> {
    try {
      const id = scenario.id || this.generateId();
      const scenarioWithMeta: ScenarioSummary = {
        ...scenario,
        id,
        timestamp: Date.now(),
      };

      // Try Firestore first (if available)
      // For now, using LocalStorage as fallback/mock
      this.saveToLocalStorage(scenarioWithMeta);
      return id;
    } catch (error) {
      console.error('Error saving scenario:', error);
      // Fallback to LocalStorage
      const id = scenario.id || this.generateId();
      const scenarioWithMeta: ScenarioSummary = {
        ...scenario,
        id,
        timestamp: Date.now(),
      };
      this.saveToLocalStorage(scenarioWithMeta);
      return id;
    }
  }

  async getScenarios(): Promise<ScenarioSummary[]> {
    try {
      // Try Firestore first (if available)
      // For now, using LocalStorage as fallback/mock
      return this.getFromLocalStorage();
    } catch (error) {
      console.error('Error fetching scenarios:', error);
      // Fallback to LocalStorage
      return this.getFromLocalStorage();
    }
  }

  async deleteScenario(id: string): Promise<void> {
    try {
      const scenarios = this.getFromLocalStorage();
      const filtered = scenarios.filter((s) => s.id !== id);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error deleting scenario:', error);
    }
  }

  private saveToLocalStorage(scenario: ScenarioSummary): void {
    try {
      const scenarios = this.getFromLocalStorage();
      const index = scenarios.findIndex((s) => s.id === scenario.id);
      if (index >= 0) {
        scenarios[index] = scenario;
      } else {
        scenarios.push(scenario);
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(scenarios));
    } catch (error) {
      console.error('LocalStorage save error:', error);
    }
  }

  private getFromLocalStorage(): ScenarioSummary[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('LocalStorage read error:', error);
      return [];
    }
  }

  private generateId(): string {
    return `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
