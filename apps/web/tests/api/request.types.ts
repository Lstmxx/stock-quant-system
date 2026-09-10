import type { ApiErrorCode, ApiFailure } from '@stock-quant/api/contracts';
import type { Treaty } from '@elysiajs/eden';
import { api } from '../../src/api/api';
import { request, type ApiData } from '../../src/api/request';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type IsAny<Value> = 0 extends (1 & Value) ? true : false;

const search = () => request(api['market-data'].search.get({ query: { q: '600519' } }));
const chart = () => request(api['market-data']({ symbol: 'sh.600519' }).kline.get());
const tasks = () => request(api.tasks['data-collection'].get());
const remove = () => request(api.llm({ id: 'model-1' }).delete());
const progress = () => request(api.tasks({ id: 'task-1' }).progress.get());
type ChartCall = ReturnType<typeof api['market-data']>['kline']['get'];
type ChartData = Awaited<ReturnType<typeof chart>>;
type ChartError = NonNullable<Awaited<ReturnType<ChartCall>>['error']>;

export type RequestInferenceAssertions = [
  Assert<Equal<Awaited<ReturnType<typeof search>>, { code: string; name: string }[]>>,
  Assert<Equal<ChartData, ApiData<ChartCall>>>,
  Assert<Equal<ChartData['symbol'], string>>,
  Assert<Equal<ChartData['bars'][number]['close'], number>>,
  Assert<Equal<IsAny<ChartData>, false>>,
  Assert<Equal<Awaited<ReturnType<typeof tasks>>['total'], number>>,
  Assert<Equal<Awaited<ReturnType<typeof remove>>, null>>,
  Assert<Equal<Awaited<ReturnType<typeof progress>>['workers'][number]['failed'], number>>,
  Assert<Equal<Extract<Treaty.Data<ChartCall>, { success: false }>, never>>,
  Assert<ChartError['value'] extends ApiFailure ? true : false>,
  Assert<ApiFailure extends ChartError['value'] ? true : false>,
  Assert<Equal<ChartError['value']['code'], ApiErrorCode>>,
  Assert<Equal<NonNullable<Treaty.Data<ChartCall>>['code'], 0>>,
  Assert<401 | 422 | 500 | 502 | 504 extends ChartError['status'] ? true : false>,
  Assert<Equal<Awaited<ReturnType<typeof remove>> extends object ? true : false, false>>,
  Assert<Equal<ApiData<() => Promise<{ data: { value: number } }>>, never>>,
  Assert<Equal<{ wrong: number } extends ChartData ? true : false, false>>,
];
