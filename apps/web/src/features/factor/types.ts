import { api } from '../../api/api';

type FactorResponse = NonNullable<Awaited<ReturnType<typeof api.factors.get>>['data']>;
export type Factor = FactorResponse['data'][number];

type TaskResponse = NonNullable<Awaited<ReturnType<typeof api.tasks.get>>['data']>;
export type FactorTask = TaskResponse[number];
