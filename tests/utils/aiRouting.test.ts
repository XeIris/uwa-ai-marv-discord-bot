import { describe, test, expect } from 'bun:test';
import { resolveTurnModel, type Persona } from '../../utils/ai';
import personas from '../../data/aiPersonas.json';

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

  test('reads media on its single model, with no vision route', () => {
    // GLM 5.3 Flash takes image and video input itself, so there is nothing to
    // route away to — every turn, media or not, runs on the one model.
    expect(marv.visionModel).toBeUndefined();
    expect(resolveTurnModel(marv, true).model).toBe(marv.model);
    expect(resolveTurnModel(marv, false).model).toBe(marv.model);
  });

  test('declares the input modalities the model actually supports', () => {
    // Audio is absent deliberately: the model takes image and video only, and
    // the system prompt tells Marv he cannot hear.
    expect(marv.mediaInput).toEqual(['image', 'video']);
  });

  test('turns chat reasoning off, on media turns too', () => {
    expect(resolveTurnModel(marv, false).reasoning).toEqual({ enabled: false });
    expect(resolveTurnModel(marv, true).reasoning).toEqual({ enabled: false });
  });

  test('runs on OpenRouter default routing', () => {
    // The price-sorted DeepSeek routing went with the DeepSeek slug; nothing
    // model-specific is pinned any more.
    expect(marv.providerRouting).toBeUndefined();
    expect(resolveTurnModel(marv, false).providerRouting).toBeUndefined();
  });
});
