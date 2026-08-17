import { Injectable } from '@angular/core';
import { ScenarioSummary } from '../models/scenario.model';

/**
 * Firestore service for persisting simulation scenario summaries.
 *
 * NOTE: Currently uses LocalStorage as fallback.
 * To enable Firestore:
 * 1. Install AngularFire: npm install @angular/fire firebase
 * 2. Configure Firebase in environment.ts
 * 3. Update AppComponent to initialize Firebase
 * 4. Uncomment Firestore implementation below and remove LocalStorage fallback
 */
@Injectable({
  providedIn: 'root',
})
export class FirestoreService {
  private readonly COLLECTION_NAME = 'simulation_results';
  private readonly LOCAL_STORAGE_KEY = 'hr_simulation_firestore_cache';

  constructor() {
    // In production, inject AngularFirestore here:
    // constructor(private firestore: AngularFirestore) {}
  }

  /**
   * Save scenario summary to Firestore
   * This saves only the essential summary data, not full employee details
   */
  async saveScenarioSummary(scenario: ScenarioSummary): Promise<string> {
    const docId = scenario.id || this.generateDocId();
    const docData = {
      ...scenario,
      id: docId,
      timestamp: Date.now(),
      createdAt: new Date(),
    };

    try {
      // Firestore implementation (when available):
      // const docRef = await this.firestore.collection(this.COLLECTION_NAME).doc(docId).set(docData);
      // return docId;

      // Fallback: Use LocalStorage
      this.saveToLocalStorageCache(docData);
      return docId;
    } catch (error) {
      console.error(`Error saving scenario to ${this.COLLECTION_NAME}:`, error);
      // Fallback to LocalStorage
      this.saveToLocalStorageCache(docData);
      return docId;
    }
  }

  /**
   * Retrieve all scenario summaries from Firestore
   */
  async getScenarioSummaries(): Promise<ScenarioSummary[]> {
    try {
      // Firestore implementation (when available):
      // const snapshot = await this.firestore.collection(this.COLLECTION_NAME).get().toPromise();
      // return snapshot?.docs.map(doc => doc.data() as ScenarioSummary) ?? [];

      // Fallback: Use LocalStorage
      return this.getFromLocalStorageCache();
    } catch (error) {
      console.error(`Error retrieving scenarios from ${this.COLLECTION_NAME}:`, error);
      // Fallback to LocalStorage
      return this.getFromLocalStorageCache();
    }
  }

  /**
   * Delete scenario summary from Firestore
   */
  async deleteScenarioSummary(docId: string): Promise<void> {
    try {
      // Firestore implementation (when available):
      // await this.firestore.collection(this.COLLECTION_NAME).doc(docId).delete();

      // Fallback: Use LocalStorage
      this.deleteFromLocalStorageCache(docId);
    } catch (error) {
      console.error(`Error deleting scenario from ${this.COLLECTION_NAME}:`, error);
      // Fallback to LocalStorage
      this.deleteFromLocalStorageCache(docId);
    }
  }

  /**
   * LocalStorage cache methods (fallback)
   */
  private saveToLocalStorageCache(scenario: ScenarioSummary): void {
    try {
      const scenarios = this.getFromLocalStorageCache();
      const index = scenarios.findIndex((s) => s.id === scenario.id);
      if (index >= 0) {
        scenarios[index] = scenario;
      } else {
        scenarios.push(scenario);
      }
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(scenarios));
    } catch (error) {
      console.error('LocalStorage save error:', error);
    }
  }

  private getFromLocalStorageCache(): ScenarioSummary[] {
    try {
      const data = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('LocalStorage read error:', error);
      return [];
    }
  }

  private deleteFromLocalStorageCache(docId: string): void {
    try {
      const scenarios = this.getFromLocalStorageCache();
      const filtered = scenarios.filter((s) => s.id !== docId);
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('LocalStorage delete error:', error);
    }
  }

  private generateDocId(): string {
    return `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
