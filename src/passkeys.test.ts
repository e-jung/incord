import {it,expect} from 'vitest';
import {passkeyError} from './passkeys';
it('N12 maps cancellation, unsupported and unknown browser errors without exposing raw messages',()=>{
 expect(passkeyError({name:'NotAllowedError',message:'raw'}).message).toBe('Cancelled');
 expect(passkeyError({name:'NotSupportedError',message:'raw'}).message).toContain("This browser can't use passkeys here");
 expect(passkeyError({name:'Error',code:'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',message:'raw secret exception'}).message).not.toContain('raw');
});
it('recognizes an existing device passkey from both native and library errors',()=>{for(const error of [{name:'InvalidStateError'},{code:'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'}])expect(passkeyError(error)).toMatchObject({name:'PasskeyAlreadyRegistered',message:'This device already has a passkey.'})});
