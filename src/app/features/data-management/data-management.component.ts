import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { Employee } from '../../core/models/simulation.model';

@Component({
  selector: 'app-data-management',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './data-management.component.html',
  styleUrl: './data-management.component.scss',
})
export class DataManagementComponent implements OnInit {
  readonly pageSize = signal<number>(10);
  readonly pageIndex = signal<number>(0);
  readonly sortField = signal<string>('id');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  displayedColumns: string[] = ['id', 'sales', 'management', 'development', 'nurture', 'personnelCost'];

  constructor(readonly store: SimulationStoreService) {}

  ngOnInit(): void {
    if (this.store.employees().length === 0) {
      this.store.loadInitialData();
    }
  }

  getPaginatedEmployees(): Employee[] {
    const employees = this.getSortedEmployees();
    const start = this.pageIndex() * this.pageSize();
    const end = start + this.pageSize();
    return employees.slice(start, end);
  }

  private getSortedEmployees(): Employee[] {
    const employees = [...this.store.employees()];
    const field = this.sortField();
    const dir = this.sortDirection();

    return employees.sort((a, b) => {
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
    });
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  onSortChange(sort: Sort): void {
    this.sortField.set(sort.active);
    this.sortDirection.set((sort.direction || 'asc') as 'asc' | 'desc');
    this.pageIndex.set(0); // Reset to first page on sort
  }

  getStrengthsWeaknesses() {
    return this.store.getStrengthsWeaknesses();
  }

  getAverageAbilities() {
    return this.store.getAverageAbilities();
  }

  getTotalEmployees(): number {
    return this.store.employees().length;
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    // Placeholder for CSV reload functionality
    const reader = new FileReader();
    reader.onload = () => {
      // In a real implementation, this would parse and reload the CSV
      console.log('File selected:', file.name);
    };
    reader.readAsText(file);
  }
}
