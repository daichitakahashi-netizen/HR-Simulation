import { Injectable } from '@angular/core';
import { ScenarioSummary, Scenario, YearDocument } from '../models/scenario.model';

@Injectable({
  providedIn: 'root',
})
export class ScenarioRepositoryService {
  private readonly STORAGE_KEY = 'hr_simulation_scenarios';

  // ---- 経年タレントマネジメント実務機能（/hr-planning）用永続化 ----
  // Firestore path: /scenarios/{scenarioId}/years/{year}
  // NOTE: 実際のFirestore接続が構成されるまでLocalStorageに疑似永続化する。
  private readonly HR_SCENARIOS_KEY = 'hr_planning_scenarios';
  private readonly HR_YEARS_KEY_PREFIX = 'hr_planning_years_';
  private readonly HR_LAST_ACTIVE_SCENARIO_KEY = 'hr_planning_last_active_scenario_id';

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

  // ==================== 経年タレントマネジメント実務機能（/hr-planning） ====================

  async createHrScenario(name: string, currentYear: number): Promise<Scenario> {
    const now = Date.now();
    const scenario: Scenario = {
      id: `hr_scenario_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      createdAt: now,
      updatedAt: now,
      currentYear,
    };
    const scenarios = this.getHrScenariosFromLocalStorage();
    scenarios.push(scenario);
    this.saveHrScenariosToLocalStorage(scenarios);
    return scenario;
  }

  async getHrScenario(scenarioId: string): Promise<Scenario | null> {
    const scenarios = this.getHrScenariosFromLocalStorage();
    return scenarios.find((s) => s.id === scenarioId) || null;
  }

  async listHrScenarios(): Promise<Scenario[]> {
    return this.getHrScenariosFromLocalStorage();
  }

  async updateHrScenario(scenario: Scenario): Promise<void> {
    const scenarios = this.getHrScenariosFromLocalStorage();
    const index = scenarios.findIndex((s) => s.id === scenario.id);
    const updated: Scenario = { ...scenario, updatedAt: Date.now() };
    if (index >= 0) {
      scenarios[index] = updated;
    } else {
      scenarios.push(updated);
    }
    this.saveHrScenariosToLocalStorage(scenarios);
  }

  async getYearDocument(scenarioId: string, year: number): Promise<YearDocument | null> {
    const years = this.getYearDocumentsFromLocalStorage(scenarioId);
    return years[year] || null;
  }

  async saveYearDocument(scenarioId: string, year: number, doc: YearDocument): Promise<void> {
    const years = this.getYearDocumentsFromLocalStorage(scenarioId);
    years[year] = doc;
    this.saveYearDocumentsToLocalStorage(scenarioId, years);
  }

  async deleteYearDocument(scenarioId: string, year: number): Promise<void> {
    const years = this.getYearDocumentsFromLocalStorage(scenarioId);
    delete years[year];
    this.saveYearDocumentsToLocalStorage(scenarioId, years);
  }

  async deleteHrScenario(scenarioId: string): Promise<void> {
    const scenarios = this.getHrScenariosFromLocalStorage().filter((s) => s.id !== scenarioId);
    this.saveHrScenariosToLocalStorage(scenarios);
    try {
      localStorage.removeItem(this.HR_YEARS_KEY_PREFIX + scenarioId);
    } catch (error) {
      console.error('LocalStorage remove error (hr years):', error);
    }
    if (this.getLastActiveScenarioId() === scenarioId) {
      try {
        localStorage.removeItem(this.HR_LAST_ACTIVE_SCENARIO_KEY);
      } catch (error) {
        console.error('LocalStorage remove error (hr last active scenario):', error);
      }
    }
  }

  saveLastActiveScenarioId(id: string): void {
    try {
      localStorage.setItem(this.HR_LAST_ACTIVE_SCENARIO_KEY, id);
    } catch (error) {
      console.error('LocalStorage save error (hr last active scenario):', error);
    }
  }

  getLastActiveScenarioId(): string | null {
    try {
      return localStorage.getItem(this.HR_LAST_ACTIVE_SCENARIO_KEY);
    } catch (error) {
      console.error('LocalStorage read error (hr last active scenario):', error);
      return null;
    }
  }

  async listYears(scenarioId: string): Promise<number[]> {
    const years = this.getYearDocumentsFromLocalStorage(scenarioId);
    return Object.keys(years)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);
  }

  private getHrScenariosFromLocalStorage(): Scenario[] {
    try {
      const data = localStorage.getItem(this.HR_SCENARIOS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('LocalStorage read error (hr scenarios):', error);
      return [];
    }
  }

  private saveHrScenariosToLocalStorage(scenarios: Scenario[]): void {
    try {
      localStorage.setItem(this.HR_SCENARIOS_KEY, JSON.stringify(scenarios));
    } catch (error) {
      console.error('LocalStorage save error (hr scenarios):', error);
    }
  }

  private getYearDocumentsFromLocalStorage(scenarioId: string): Record<number, YearDocument> {
    try {
      const data = localStorage.getItem(this.HR_YEARS_KEY_PREFIX + scenarioId);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('LocalStorage read error (hr years):', error);
      return {};
    }
  }

  private saveYearDocumentsToLocalStorage(scenarioId: string, years: Record<number, YearDocument>): void {
    try {
      localStorage.setItem(this.HR_YEARS_KEY_PREFIX + scenarioId, JSON.stringify(years));
    } catch (error) {
      console.error('LocalStorage save error (hr years):', error);
    }
  }
}
