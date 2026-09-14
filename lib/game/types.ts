import type { Database, Json } from "@/lib/supabase/database.types";

export type Game = Database["public"]["Tables"]["games"]["Row"];
export type GameState = Database["public"]["Tables"]["game_state"]["Row"];
export type Question = Database["public"]["Tables"]["questions"]["Row"];
export type Participant = Database["public"]["Tables"]["participants"]["Row"];
export type Answer = Database["public"]["Tables"]["answers"]["Row"];

export type ParticipantSession = {
  gameId: string;
  gameSlug: string;
  name: string;
  participantId: string;
  sessionToken: string;
};

export type PublicGameSnapshot = {
  game: Pick<Game, "id" | "join_open" | "slug" | "title">;
  question: Question | null;
  state: GameState;
};

export type SubmissionValue = string | number;

export type SubmissionReceipt = {
  answer: Json;
  gradingStatus: Database["public"]["Enums"]["grading_status"];
  id: string;
  isDuplicate: boolean;
  submittedAt: string;
};
