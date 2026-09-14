export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      answers: {
        Row: {
          answer: Json;
          finalized_at: string | null;
          finalized_by: string | null;
          game_id: string;
          grading_note: string | null;
          grading_status: Database["public"]["Enums"]["grading_status"];
          id: string;
          is_finalized: boolean;
          participant_id: string;
          question_id: string;
          submitted_at: string;
          updated_at: string;
        };
        Insert: {
          answer: Json;
          finalized_at?: string | null;
          finalized_by?: string | null;
          game_id: string;
          grading_note?: string | null;
          grading_status?: Database["public"]["Enums"]["grading_status"];
          id?: string;
          is_finalized?: boolean;
          participant_id: string;
          question_id: string;
          submitted_at?: string;
          updated_at?: string;
        };
        Update: {
          answer?: Json;
          finalized_at?: string | null;
          finalized_by?: string | null;
          grading_note?: string | null;
          grading_status?: Database["public"]["Enums"]["grading_status"];
          is_finalized?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      game_action_log: {
        Row: {
          action_type: string;
          after_state: Json;
          before_state: Json;
          created_at: string;
          game_id: string;
          id: string;
          performed_by: string;
          undone_at: string | null;
          undone_by: string | null;
        };
        Insert: {
          action_type: string;
          after_state: Json;
          before_state: Json;
          created_at?: string;
          game_id: string;
          id?: string;
          performed_by: string;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Update: {
          after_state?: Json;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Relationships: [];
      };
      grading_batch_items: {
        Row: {
          answer_id: string | null;
          batch_id: string;
          next_status: Database["public"]["Enums"]["participant_status"];
          participant_id: string;
          previous_status: Database["public"]["Enums"]["participant_status"];
        };
        Insert: {
          answer_id?: string | null;
          batch_id: string;
          next_status: Database["public"]["Enums"]["participant_status"];
          participant_id: string;
          previous_status: Database["public"]["Enums"]["participant_status"];
        };
        Update: never;
        Relationships: [];
      };
      grading_batches: {
        Row: {
          finalized_at: string;
          finalized_by: string;
          game_id: string;
          id: string;
          question_id: string;
          undone_at: string | null;
          undone_by: string | null;
        };
        Insert: {
          finalized_at?: string;
          finalized_by: string;
          game_id: string;
          id?: string;
          question_id: string;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Update: {
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Relationships: [];
      };
      game_admins: {
        Row: {
          game_id: string;
          granted_at: string;
          user_id: string;
        };
        Insert: {
          game_id: string;
          granted_at?: string;
          user_id: string;
        };
        Update: never;
        Relationships: [];
      };
      game_state: {
        Row: {
          active_count: number;
          answer_revealed: boolean;
          current_question_id: string | null;
          deadline_at: string | null;
          game_id: string;
          grading_finalized: boolean;
          participant_count: number;
          phase: Database["public"]["Enums"]["game_phase"];
          revealed_answer: Json | null;
          revision: number;
          submission_count: number;
          submissions_open: boolean;
          timer_started_at: string | null;
          updated_at: string;
        };
        Insert: {
          active_count?: number;
          answer_revealed?: boolean;
          current_question_id?: string | null;
          deadline_at?: string | null;
          game_id: string;
          grading_finalized?: boolean;
          participant_count?: number;
          phase?: Database["public"]["Enums"]["game_phase"];
          revealed_answer?: Json | null;
          revision?: number;
          submission_count?: number;
          submissions_open?: boolean;
          timer_started_at?: string | null;
          updated_at?: string;
        };
        Update: {
          answer_revealed?: boolean;
          current_question_id?: string | null;
          deadline_at?: string | null;
          grading_finalized?: boolean;
          phase?: Database["public"]["Enums"]["game_phase"];
          revealed_answer?: Json | null;
          submissions_open?: boolean;
          timer_started_at?: string | null;
        };
        Relationships: [];
      };
      games: {
        Row: {
          created_at: string;
          id: string;
          is_public: boolean;
          join_open: boolean;
          slug: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_public?: boolean;
          join_open?: boolean;
          slug: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          is_public?: boolean;
          join_open?: boolean;
          slug?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      participants: {
        Row: {
          game_id: string;
          id: string;
          joined_at: string;
          last_seen_at: string;
          name: string;
          session_token_hash: string;
          status: Database["public"]["Enums"]["participant_status"];
          updated_at: string;
        };
        Insert: {
          game_id: string;
          id?: string;
          joined_at?: string;
          last_seen_at?: string;
          name: string;
          session_token_hash: string;
          status?: Database["public"]["Enums"]["participant_status"];
          updated_at?: string;
        };
        Update: {
          last_seen_at?: string;
          name?: string;
          status?: Database["public"]["Enums"]["participant_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      question_answer_keys: {
        Row: {
          correct_answers: Json;
          grading_note: string | null;
          question_id: string;
          updated_at: string;
        };
        Insert: {
          correct_answers: Json;
          grading_note?: string | null;
          question_id: string;
          updated_at?: string;
        };
        Update: {
          correct_answers?: Json;
          grading_note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          choices: Json | null;
          created_at: string;
          game_id: string;
          id: string;
          question_order: number;
          question_text: string;
          time_limit_seconds: number;
          type: Database["public"]["Enums"]["question_type"];
          updated_at: string;
        };
        Insert: {
          choices?: Json | null;
          created_at?: string;
          game_id: string;
          id?: string;
          question_order: number;
          question_text: string;
          time_limit_seconds?: number;
          type: Database["public"]["Enums"]["question_type"];
          updated_at?: string;
        };
        Update: {
          choices?: Json | null;
          question_order?: number;
          question_text?: string;
          time_limit_seconds?: number;
          type?: Database["public"]["Enums"]["question_type"];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_control_game: {
        Args: {
          p_action: string;
          p_game_id: string;
          p_question_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["game_state"]["Row"];
      };
      auto_grade_question: {
        Args: {
          p_game_id: string;
          p_question_id?: string | null;
        };
        Returns: Json;
      };
      finalize_question_grades: {
        Args: {
          p_game_id: string;
          p_question_id?: string | null;
        };
        Returns: Json;
      };
      is_game_admin: {
        Args: { target_game_id: string };
        Returns: boolean;
      };
      normalize_short_answer: {
        Args: { input: string };
        Returns: string;
      };
      reset_game_for_testing: {
        Args: {
          p_game_id: string;
          p_mode?: string;
        };
        Returns: Database["public"]["Tables"]["game_state"]["Row"];
      };
      set_answer_grade: {
        Args: {
          p_answer_id: string;
          p_game_id: string;
          p_note?: string | null;
          p_status: Database["public"]["Enums"]["grading_status"];
        };
        Returns: Database["public"]["Tables"]["answers"]["Row"];
      };
      submit_answer: {
        Args: {
          p_answer: Json;
          p_game_slug: string;
          p_participant_id: string;
          p_question_id: string;
          p_session_token_hash: string;
        };
        Returns: Json;
      };
      undo_finalize_question_grades: {
        Args: {
          p_game_id: string;
          p_question_id?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      game_phase: "lobby" | "question" | "closed" | "judging" | "answer" | "finished";
      grading_status: "ungraded" | "correct" | "incorrect" | "pending";
      participant_status: "active" | "eliminated" | "pending" | "revived";
      question_type: "ox" | "multiple_choice" | "short_answer";
    };
    CompositeTypes: Record<string, never>;
  };
};
