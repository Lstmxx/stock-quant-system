import { api } from '../../api/api';

type FactorResponse = NonNullable<Awaited<ReturnType<typeof api.factors.get>>['data']>;
export type Factor = FactorResponse['data'][number];

type TaskResponse = NonNullable<Awaited<ReturnType<typeof api.tasks.get>>['data']>;
export type FactorTask = TaskResponse[number];

type FactorSelectionListResponse = NonNullable<
  Awaited<ReturnType<typeof api['factor-selections']['get']>>['data']
>;
export type FactorSelectionTask = FactorSelectionListResponse['data'][number];

type FactorSelectionDetailCall = ReturnType<typeof api['factor-selections']>;
type FactorSelectionDetailResponse = NonNullable<
  Awaited<ReturnType<FactorSelectionDetailCall['get']>>['data']
>;
export type FactorSelectionDetail = Extract<FactorSelectionDetailResponse, { task: unknown }>;
export type FactorSelectionResult = FactorSelectionDetail['results'][number];
