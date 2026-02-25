import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TextFieldModule } from '@angular/cdk/text-field';

@Component({
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TextFieldModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-chat-input',
  styleUrls: ['./chat-input.scss'],
  templateUrl: './chat-input.html'
})
export class GfChatInputComponent {
  @Input() isLoading = false;
  @Output() messageSent = new EventEmitter<string>();

  public inputMessage = '';

  public onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  public send() {
    const message = this.inputMessage.trim();
    if (!message || this.isLoading) {
      return;
    }
    this.messageSent.emit(message);
    this.inputMessage = '';
  }
}
