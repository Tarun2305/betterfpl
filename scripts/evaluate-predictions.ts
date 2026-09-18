import { readFile } from 'node:fs/promises';
import { PredictionStore } from '../lib/prediction-store';
import { evaluateSavedForecasts } from '../lib/forecast-evaluation';
import type { ForecastHistory } from '../lib/football-model';
import type { SavedFixture } from '../lib/prediction-worker';
const history = JSON.parse(
  await readFile('work/prediction-engine/history.json', 'utf8'),
) as ForecastHistory;
const store = await PredictionStore.open();
try {
  console.log(
    JSON.stringify(
      evaluateSavedForecasts(store.all<SavedFixture>('fixtures'), history),
      null,
      2,
    ),
  );
} finally {
  store.close();
}
