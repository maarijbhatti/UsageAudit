import {CallHandler,ExecutionContext,Injectable,NestInterceptor} from '@nestjs/common';
import {finalize} from 'rxjs';
import {unlink} from 'node:fs/promises';
import type {Request} from 'express';
@Injectable() export class UploadCleanup implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler){const req=context.switchToHttp().getRequest<Request>();return next.handle().pipe(finalize(()=>{if(req.file?.path)void unlink(req.file.path).catch(()=>undefined);}));}
}
