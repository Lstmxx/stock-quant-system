import { api } from '../../api/api';

type LlmResponse = NonNullable<Awaited<ReturnType<typeof api.llm.get>>['data']>;
export type LlmModel = LlmResponse[number];
