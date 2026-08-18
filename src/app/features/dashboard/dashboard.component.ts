import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { AllocationResult } from '../../core/models/simulation.model';
import { MemberDialogComponent } from './member-dialog/member-dialog.component';

@Component({
  selector: 'app-dashboard',
  imports: [
    CommonModule,
    MatCardModule,
    MatRadioModule,
    MatButtonToggleModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatButtonModule,
    MatDialogModule,
    BaseChartDirective,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private store = inject(SimulationStoreService);
  private dialog = inject(MatDialog);

  readonly isLoading = this.store.isLoading;
  readonly simulationResult = this.store.simulationResult;
  readonly baselineResult = this.store.baselineResult;
  readonly selectedObjective = this.store.selectedObjective;
  readonly employeeCount = this.store.employeeCount;
  readonly reasonText = this.store.reasonText;
  readonly is110Mode = this.store.is110Mode;

  departments = [
    { id: 'A', label: '事業部A' },
    { id: 'B', label: '事業部B' },
    { id: 'C', label: '事業部C' },
  ];

  objectives = [
    { value: 'totalRevenue', label: '全社売上最大化' },
    { value: 'departmentAProfitMaximize', label: 'A事業部利益最大化' },
    { value: 'departmentBRevenueMaximize', label: 'B事業部売上最大化' },
    { value: 'departmentCRevenueMaximize', label: 'C事業部売上最大化' },
  ];

  // Revenue chart configuration
  revenueChartData = computed(() => {
    const result = this.simulationResult();
    if (!result) {
      return {
        labels: [],
        datasets: [],
      };
    }

    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: '売上',
          data: [
            result.department['A'].finalRevenue,
            result.department['B'].finalRevenue,
            result.department['C'].finalRevenue,
          ],
          backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  // Cost chart configuration
  costChartData = computed(() => {
    const result = this.simulationResult();
    if (!result) {
      return {
        labels: [],
        datasets: [],
      };
    }

    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: 'コスト',
          data: [
            result.department['A'].cost,
            result.department['B'].cost,
            result.department['C'].cost,
          ],
          backgroundColor: ['#FFB6B9', '#A8E6CF', '#FFD3B6'],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  // Profit chart configuration
  profitChartData = computed(() => {
    const result = this.simulationResult();
    if (!result) {
      return {
        labels: [],
        datasets: [],
      };
    }

    return {
      labels: ['A事業部', 'B事業部', 'C事業部'],
      datasets: [
        {
          label: '利益',
          data: [
            result.department['A'].profit,
            result.department['B'].profit,
            result.department['C'].profit,
          ],
          backgroundColor: ['#FFE5E5', '#D4F1E4', '#FFE5CC'],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  donutChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
    },
  };

  donutChartType = 'doughnut' as const;

  // KPI differences for 110 mode
  kpiDifferences = computed(() => {
    const current = this.simulationResult();
    const baseline = this.baselineResult();
    const is110 = this.is110Mode();

    if (!current || !baseline || !is110) {
      return null;
    }

    return {
      revenueDiff: current.summary.totalRevenue - baseline.summary.totalRevenue,
      costDiff: current.summary.totalCost - baseline.summary.totalCost,
      profitDiff: current.summary.totalProfit - baseline.summary.totalProfit,
    };
  });

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

  onEmployeeCountChange(value: number): void {
    this.store.setEmployeeCount(value);
  }

  openMemberDialog(departmentId: string, departmentLabel: string): void {
    const allocatedIds = this.store.allocatedEmployeeIds();
    const deptAllocatedIds = allocatedIds[departmentId] || [];

    this.dialog.open(MemberDialogComponent, {
      width: '900px',
      maxHeight: '90vh',
      data: {
        departmentId,
        departmentLabel,
        allocatedEmployeeIds: deptAllocatedIds,
        employees: this.store.employees(),
      },
    });
  }

  getDepartmentResult(
    result: AllocationResult | null,
    deptId: string
  ) {
    return result?.department[deptId];
  }
}
