import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-save-scenario-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title>シナリオを保存</h2>
      <mat-dialog-content>
        <mat-form-field appearance="outline" class="scenario-name-field">
          <mat-label>シナリオ名</mat-label>
          <input
            matInput
            [(ngModel)]="scenarioName"
            placeholder="例: 売上最大化案（110名体制）"
            (keyup.enter)="onSave()">
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()">キャンセル</button>
        <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!scenarioName.trim()">
          保存
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container {
      min-width: 350px;
    }
    .scenario-name-field {
      width: 100%;
    }
    mat-dialog-content {
      padding: 20px 0;
    }
  `],
})
export class SaveScenarioDialogComponent {
  scenarioName = '';
  private dialogRef = inject(MatDialogRef<SaveScenarioDialogComponent>);

  onSave(): void {
    if (this.scenarioName.trim()) {
      this.dialogRef.close(this.scenarioName.trim());
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
