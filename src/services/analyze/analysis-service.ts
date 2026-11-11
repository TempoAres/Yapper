import type { Guild } from "discord.js";
import { collectAnalysisHistory, type AnalysisHistory } from "./history.js";
import type { AnalysisSummarizer } from "./summarizer.js";

export interface AnalysisResult {
  history: AnalysisHistory;
  summary: string | undefined;
}

export interface AnalysisService {
  analyze(guild: Guild, userId: string): Promise<AnalysisResult>;
}

export class DiscordAnalysisService implements AnalysisService {
  public constructor(private readonly summarizer: AnalysisSummarizer) {}

  public async analyze(guild: Guild, userId: string): Promise<AnalysisResult> {
    const history = await collectAnalysisHistory(guild, userId);
    return {
      history,
      summary: history.messages.length ? await this.summarizer.summarize(history) : undefined,
    };
  }
}
