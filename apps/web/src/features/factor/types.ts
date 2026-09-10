import type { api } from '../../api/api';
import type { ApiData } from '../../api/request';

type FactorResponse = ApiData<typeof api.factors.get>;
export type Factor = FactorResponse['data'][number];

type TaskResponse = ApiData<typeof api.tasks.get>;
export type FactorTask = TaskResponse[number];

type FactorSelectionListResponse = ApiData<typeof api['factor-selections']['get']>;
export type FactorSelectionTask = FactorSelectionListResponse['data'][number];

type FactorSelectionDetailCall = ReturnType<typeof api['factor-selections']>;
export type FactorSelectionDetail = ApiData<FactorSelectionDetailCall['get']>;
export type FactorSelectionResult = FactorSelectionDetail['results'][number];
