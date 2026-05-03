export type LearningConfig = {
  learning_enabled: boolean;
};

let learningEnabled = false;

export function getLearningConfig(): LearningConfig {
  return {
    learning_enabled: learningEnabled,
  };
}

export function setLearningEnabled(flag: boolean): LearningConfig {
  learningEnabled = flag === true;
  return getLearningConfig();
}