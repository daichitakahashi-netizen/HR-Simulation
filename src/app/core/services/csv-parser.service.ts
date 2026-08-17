import { Injectable } from '@angular/core';
import { Employee } from '../models/simulation.model';

@Injectable({
  providedIn: 'root',
})
export class CsvParserService {
  // Parse CSV text to Employee array
  parseEmployeesCsv(csvText: string): Employee[] {
    const lines = csvText.split('\n');
    const employees: Employee[] = [];

    // Skip header (first line)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      try {
        const columns = line.split(',');

        // Validate column count (should have 6 columns)
        if (columns.length < 6) {
          continue;
        }

        const id = columns[0].trim();
        const sales = parseInt(columns[1].trim(), 10);
        const management = parseInt(columns[2].trim(), 10);
        const development = parseInt(columns[3].trim(), 10);
        const nurture = parseInt(columns[4].trim(), 10);
        const personnelCost = parseFloat(columns[5].trim());

        // Validate values
        if (
          !id ||
          isNaN(sales) ||
          isNaN(management) ||
          isNaN(development) ||
          isNaN(nurture) ||
          isNaN(personnelCost)
        ) {
          continue;
        }

        // Validate ability ranges (0-100)
        if (
          sales < 0 || sales > 100 ||
          management < 0 || management > 100 ||
          development < 0 || development > 100 ||
          nurture < 0 || nurture > 100
        ) {
          continue;
        }

        // Validate personnel cost range (1-20)
        if (personnelCost < 1 || personnelCost > 20) {
          continue;
        }

        employees.push({
          id,
          sales,
          management,
          development,
          nurture,
          personnelCost,
        });
      } catch (error) {
        // Skip rows with parsing errors
        continue;
      }
    }

    return employees;
  }
}
