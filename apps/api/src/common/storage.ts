import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { getConfig } from "@usageaudit/config";
@Injectable()
export class Storage {
  private cfg = getConfig();
  private client = new S3Client({
    endpoint: this.cfg.S3_ENDPOINT,
    region: this.cfg.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: this.cfg.S3_ACCESS_KEY,
      secretAccessKey: this.cfg.S3_SECRET_KEY,
    },
  });
  async initialize() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }),
      );
    } catch (e) {
      if (
        (e as { $metadata?: { httpStatusCode: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw e;
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }),
      );
    }
  }
  async put(
    key: string,
    body: Readable | Buffer | string,
    size?: number,
    contentType = "text/csv",
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }
  async get(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }),
    );
    if (!(result.Body instanceof Readable))
      throw new Error("Object storage stream unavailable");
    return result.Body;
  }
}
