import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { AllocationResult } from '../../core/models/simulation.model';

@Component({
  selector: 'app-dashboard',
  imports: [
    CommonModule,
    MatCardModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private store = inject(SimulationStoreService);

  readonly isLoading = this.store.isLoading;
  readonly simulationResult = this.store.simulationResult;
  readonly selectedObjective = this.store.selectedObjective;
  readonly employeeCount = this.store.employeeCount;
  readonly reasonText = this.store.reasonText;

  departments = [
    { id: 'A', label: '事業部A' },
    { id: 'B', label: '事業部B' },
    { id: 'C', label: '事業部C' },
  ];

  objectives = [
    { value: 'total_revenue', label: '全社売上最大化' },
    { value: 'a_profit', label: 'A事業部利益最大化' },
    { value: 'b_revenue', label: 'B事業部売上最大化' },
    { value: 'c_revenue', label: 'C事業部売上最大化' },
  ];

  ngOnInit(): void {
    this.store.loadInitialData();
    // Set initial allocation (100 employees distributed across departments)
    if (!this.store.allocation() || Object.keys(this.store.allocation()).length === 0) {
      this.store.updateAllocation({
        'A': 40,
        'B': 35,
        'C': 25,
      });
    }
  }

  onObjectiveChange(objective: string): void {
    this.store.updateObjective(objective);
  }

  onEmployeeCountToggle(checked: boolean): void {
    const newCount = checked ? 110 : 100;
    this.store.setEmployeeCount(newCount);
  }

  getDepartmentResult(
    result: AllocationResult | null,
    deptId: string
  ) {
    return result?.department[deptId];
  }
}
