// storage-js download() uses noResolveJson and can wrap a raw Response rather
// than exposing statusCode. Do not mistake permission/network failures for empty data.
export async function isMissingStorageObject(error: unknown): Promise<boolean> {
  if (!error || typeof error!=='object') return false;
  const wrapped=error as {statusCode?:string|number;message?:string;originalError?:unknown};
  let status=String(wrapped.statusCode ?? ''), message=wrapped.message ?? '';
  const response=wrapped.originalError;
  if (response instanceof Response) {
    const body=await response.clone().json().catch(()=>null) as {statusCode?:string|number;message?:string;error?:string;code?:string}|null;
    status=String(body?.statusCode ?? response.status);
    message=body?.message ?? body?.error ?? body?.code ?? '';
  }
  return status==='404' && /^(object not found|the specified key does not exist\.?|NoSuchKey|not_found)$/i.test(message.trim());
}
