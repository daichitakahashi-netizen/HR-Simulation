import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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
    MatSelectModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatButtonModule,
    MatDialogModule,
    MatBadgeModule,
    MatSnackBarModule,
    BaseChartDirective,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private store = inject(SimulationStoreService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  readonly Object = Object;

  readonly isLoading = this.store.isLoading;
  readonly simulationResult = this.store.simulationResult;
  readonly baselineResult = this.store.baselineResult;
  readonly selectedObjective = this.store.selectedObjective;
  readonly employeeCount = this.store.employeeCount;
  readonly reasonText = this.store.reasonText;
  readonly is110Mode = this.store.is110Mode;
  readonly has110Data = this.store.has110Data;
  readonly insufficientDataWarning = this.store.insufficientDataWarning;

  departments = [
    { id: 'A', label: '事業部A' },
    { id: 'B', label: '事業部B' },
    { id: 'C', label: '事業部C' },
  ];

  readonly lockedEmployees = this.store.lockedEmployees;
  readonly hasLockedEmployees = computed(() => {
    return Object.keys(this.store.lockedEmployees()).length > 0;
  });

  objectives = [
    { value: 'totalRevenue', label: '全社売上最大化' },
    { value: 'departmentAProfitMaximize', label: 'A事業部利益最大化' },
    { value: 'departmentBRevenueMaximize', label: 'B事業部売上最大化' },
    { value: 'departmentCRevenueMaximize', label: 'C事業部売上最大化' },
  ];

  // Department colors (A=blue, B=green, C=orange)
  private readonly deptColors = {
    A: '#1976D2',  // Blue
    B: '#4CAF50',  // Green
    C: '#FF9800',  // Orange
  };

  private readonly deptColorsLight = {
    A: '#BBDEFB',  // Light blue
    B: '#C8E6C9',  // Light green
    C: '#FFE0B2',  // Light orange
  };

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
          backgroundColor: [this.deptColors.A, this.deptColors.B, this.deptColors.C],
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
          backgroundColor: [this.deptColorsLight.A, this.deptColorsLight.B, this.deptColorsLight.C],
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
          backgroundColor: [this.deptColorsLight.A, this.deptColorsLight.B, this.deptColorsLight.C],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    };
  });

  // Check if revenue is below warning threshold (58億円)
  readonly isBelowThreshold = computed(() => {
    const result = this.simulationResult();
    return result && result.summary.totalRevenue < 58;
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

    const revenueDiff = current.summary.totalRevenue - baseline.summary.totalRevenue;
    const costDiff = current.summary.totalCost - baseline.summary.totalCost;
    const profitDiff = current.summary.totalProfit - baseline.summary.totalProfit;

    return {
      revenueDiff,
      costDiff,
      profitDiff,
      revenueSign: revenueDiff >= 0 ? '+' : '',
      costSign: costDiff >= 0 ? '+' : '',
      profitSign: profitDiff >= 0 ? '+' : '',
    };
  });

  // Department differences for detailed comparison
  deptDifferences = computed(() => {
    const current = this.simulationResult();
    const baseline = this.baselineResult();
    const is110 = this.is110Mode();

    if (!current || !baseline || !is110) {
      return null;
    }

    return {
      A: {
        allocatedDiff: current.department['A'].allocatedEmployees - baseline.department['A'].allocatedEmployees,
        revenueDiff: current.department['A'].finalRevenue - baseline.department['A'].finalRevenue,
        profitDiff: current.department['A'].profit - baseline.department['A'].profit,
      },
      B: {
        allocatedDiff: current.department['B'].allocatedEmployees - baseline.department['B'].allocatedEmployees,
        revenueDiff: current.department['B'].finalRevenue - baseline.department['B'].finalRevenue,
        profitDiff: current.department['B'].profit - baseline.department['B'].profit,
      },
      C: {
        allocatedDiff: current.department['C'].allocatedEmployees - baseline.department['C'].allocatedEmployees,
        revenueDiff: current.department['C'].finalRevenue - baseline.department['C'].finalRevenue,
        profitDiff: current.department['C'].profit - baseline.department['C'].profit,
      },
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

  getDeptDifference(deptId: string, metric: 'allocatedDiff' | 'revenueDiff' | 'profitDiff'): number {
    const diffs = this.deptDifferences();
    if (!diffs) return 0;

    const deptDiff = diffs[deptId as keyof typeof diffs];
    if (!deptDiff) return 0;

    return deptDiff[metric];
  }

  // Safely format numeric values, handling NaN/undefined
  safeFormatNumber(value: number | undefined | null, digits: string = '1.2-2'): string {
    if (value === null || value === undefined || isNaN(value)) {
      return '—';
    }
    return new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  // Check if a number is valid (not NaN, not undefined, not null)
  isValidNumber(value: number | undefined | null): boolean {
    return value !== null && value !== undefined && !isNaN(value);
  }
}
