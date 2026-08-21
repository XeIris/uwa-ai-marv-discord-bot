import { describe, test, expect } from 'bun:test';
import { resolveTurnModel, type Persona } from '../../utils/ai';
import personas from '../../data/aiPersonas.json';
import { getContextLimit, trimHistoryToFit } from '../../utils/tokenizer';

const dual: Persona = {
  name: 'Dual',
  provider: 'openrouter',
  model: 'text/model',
  providerRouting: { sort: 'price' },
  visionModel: 'vision/model',
  visionProviderRouting: { only: ['someone'] },
};

describe('resolveTurnModel', () => {
  test('text turns take the cheap model and its routing', () => {
    expect(resolveTurnModel(dual, false)).toEqual({
      model: 'text/model',
      providerRouting: { sort: 'price' },
    });
  });

  test('turns with readable media take the vision model', () => {
    expect(resolveTurnModel(dual, true)).toEqual({
      model: 'vision/model',
      providerRouting: { only: ['someone'] },
    });
  });

  test('routing never leaks across models', () => {
    // A provider pin for the text model is meaningless (and often invalid) for
    // the vision model — it must not ride along.
    const oneSided: Persona = { ...dual, visionProviderRouting: undefined };
    expect(resolveTurnModel(oneSided, true).providerRouting).toBeUndefined();
  });

  test('a persona without a vision model always uses its single model', () => {
    const single: Persona = { name: 'Single', provider: 'openrouter', model: 'only/model' };
    expect(resolveTurnModel(single, true)).toEqual({
      model: 'only/model',
      providerRouting: undefined,
    });
  });
});

describe('Marv persona wiring', () => {
  const marv = (personas as any).personas.find((p: any) => p.name === 'Marv') as Persona;

  test('routes image turns to a model that can actually read them', () => {
    // The default model is text-only: without visionModel every attached image
    // would be silently dropped.
    expect(marv.visionModel).toBeTruthy();
    expect(resolveTurnModel(marv, true).model).toBe(marv.visionModel!);
    expect(resolveTurnModel(marv, false).model).toBe(marv.model);
  });

  test('declares image input, since that is what the vision route exists for', () => {
    expect(marv.mediaInput).toEqual(['image']);
  });

  test('turns chat reasoning off on the text route only', () => {
    expect(resolveTurnModel(marv, false).reasoning).toEqual({ enabled: false });
    // The vision model is a different provider with different reasoning
    // semantics — the text route's setting must not follow it there.
    expect(resolveTurnModel(marv, true).reasoning).toBeUndefined();
  });

  test('price-sorted DeepSeek routing still demands tool support', () => {
    // sort: price with require_parameters off could land on an endpoint that
    // can't do tools, which would silently cost Marv the club tools.
    expect(resolveTurnModel(marv, false).providerRouting).toMatchObject({
      sort: 'price',
      require_parameters: true,
      data_collection: 'deny',
    });
  });
});

describe('the text-only fallback budget', () => {
  const marv = (personas as any).personas.find((p: any) => p.name === 'Marv') as Persona;

  test('Marv\'s text route has the smaller context window', () => {
    // This asymmetry is the whole reason keywordsBehaviorHandler re-trims before
    // retrying text-only. History trimmed to fit the vision window can overflow
    // the text one, and the retry that was meant to rescue the reply would 400.
    expect(getContextLimit(marv.model)).toBeLessThan(getContextLimit(marv.visionModel!));
  });

  test('history that fits the vision window is trimmed for the text model', async () => {
    // Sized between the two windows: comfortably inside 1.05M tokens, well past
    // 262k. Each entry is ~40k tokens at the tokenizer's 4-chars-per-token rate.
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      message: 'x'.repeat(160_000),
    }));

    const onVision = await trimHistoryToFit('openrouter', marv.visionModel!, '', history, 'hello', false);
    const onText = await trimHistoryToFit('openrouter', marv.model, '', history, 'hello', false);

    expect(onVision.trimmedHistory).toHaveLength(history.length);
    expect(onText.trimmedHistory.length).toBeLessThan(history.length);
  });
});
