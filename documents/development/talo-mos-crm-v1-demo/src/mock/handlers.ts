/** HTTP-style response envelope for the 40 specified paths. UI adapter deliberately unwraps data. */
import {ApiError} from '../domain/types';
import type {ApiResponse} from '../domain/types';
import {MockCrmApi} from './service';
import type {RequestOptions} from './service';
const mock=new MockCrmApi();
export async function handleMockRequest<T=unknown>(path:string,opts:RequestOptions={}):Promise<{status:number;body:ApiResponse<T>}>{
 try{return {status:200,body:{data:await mock.call<T>(path,opts)}}}
 catch(e){if(e instanceof ApiError)return {status:e.status,body:{error:{code:e.code,message:e.message,requestId:'demo-'+crypto.randomUUID()}}};throw e}
}
