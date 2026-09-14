"use client";

import type { Question, SubmissionValue } from "@/lib/game/types";

type QuestionInputProps = {
  disabled: boolean;
  onChange: (value: SubmissionValue) => void;
  question: Question;
  value: SubmissionValue | null;
};

export function QuestionInput({ disabled, onChange, question, value }: QuestionInputProps) {
  if (question.type === "ox") {
    return (
      <div className="answer-options answer-options-ox">
        {["O", "X"].map((option) => (
          <button
            className={value === option ? "answer-option selected" : "answer-option"}
            disabled={disabled}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "multiple_choice") {
    const choices = Array.isArray(question.choices) ? question.choices : [];
    return (
      <div className="answer-options">
        {choices.map((choice, index) => (
          <button
            className={value === index ? "answer-option selected" : "answer-option"}
            disabled={disabled}
            key={`${index}-${String(choice)}`}
            onClick={() => onChange(index)}
            type="button"
          >
            <span>{index + 1}</span>
            {String(choice)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <label className="short-answer-field">
      <span>주관식 답안</span>
      <input
        autoComplete="off"
        disabled={disabled}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        placeholder="답안을 입력해주세요"
        type="text"
        value={typeof value === "string" ? value : ""}
      />
    </label>
  );
}
