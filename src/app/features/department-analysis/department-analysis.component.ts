import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSortModule, Sort } from '@angular/material/sort';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { Employee } from '../../core/models/simulation.model';

@Component({
  selector: 'app-department-analysis',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    MatSortModule,
  ],
  templateUrl: './department-analysis.component.html',
  styleUrl: './department-analysis.component.scss',
})
export class DepartmentAnalysisComponent implements OnInit {
  readonly departments = signal<string[]>(['A', 'B', 'C']);
  readonly selectedDept = signal<string>('A');
  readonly searchFilter = signal<string>('');
  readonly sortField = signal<string>('id');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  displayedColumns: string[] = ['id', 'sales', 'management', 'development', 'nurture', 'personnelCost', 'lock'];

  constructor(readonly store: SimulationStoreService) {}

  ngOnInit(): void {
    if (this.store.employees().length === 0) {
      this.store.loadInitialData();
    }
  }

  getEmployeesForDept(): Employee[] {
    const dept = this.selectedDept();
    const employees = this.store.employees();
    const result = this.store.simulationResult();

    if (!result) {
      return [];
    }

    // This is a simplified approach - in a real app, we'd need to track which employees
    // are allocated to which department in the simulation result
    // For now, return employees filtered by lock status or from allocation
    const allocation = result.allocation[dept] || 0;
    const locked = this.store.lockedEmployees();
    const lockedInDept = Object.entries(locked)
      .filter(([, d]) => d === dept)
      .map(([id]) => employees.find((e) => e.id === id))
      .filter((e) => e !== undefined) as Employee[];

    // Add more employees to reach allocation count (simplified)
    const remaining = employees.filter(
      (e) => !lockedInDept.some((le) => le.id === e.id)
    );
    const additionalCount = Math.max(0, allocation - lockedInDept.length);
    const filtered = [...lockedInDept, ...remaining.slice(0, additionalCount)];

    // Apply search filter
    const search = this.searchFilter().toLowerCase();
    return filtered
      .filter((e) =>
        e.id.toLowerCase().includes(search) ||
        e.sales.toString().includes(search) ||
        e.management.toString().includes(search)
      )
      .sort(this.getSortComparator());
  }

  private getSortComparator() {
    const field = this.sortField();
    const dir = this.sortDirection();
    return (a: Employee, b: Employee) => {
      let aVal: any = a[field as keyof Employee];
      let bVal: any = b[field as keyof Employee];

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) {
        return dir === 'asc' ? -1 : 1;
      }
      if (aVal > bVal) {
        return dir === 'asc' ? 1 : -1;
      }
      return 0;
    };
  }

  onSortChange(sort: Sort): void {
    this.sortField.set(sort.active);
    this.sortDirection.set((sort.direction || 'asc') as 'asc' | 'desc');
  }

  getDeptSummary() {
    const result = this.store.simulationResult();
    if (!result) {
      return null;
    }
    return result.department[this.selectedDept()];
  }

  toggleLock(employee: Employee): void {
    this.store.toggleLock(employee.id, this.selectedDept());
  }

  isLocked(employee: Employee): boolean {
    const locked = this.store.lockedEmployees()[employee.id];
    return locked === this.selectedDept();
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchFilter.set(target.value);
  }
}
