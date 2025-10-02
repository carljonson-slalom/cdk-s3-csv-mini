import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class CdkS3CsvStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1) S3 bucket
    const bucket = new s3.Bucket(this, 'CsvBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // demo only
      autoDeleteObjects: true,                  // demo only
    });

    // 2) Upload local ./data into s3://<bucket>/seed/
    new s3deploy.BucketDeployment(this, 'UploadCsv', {
      destinationBucket: bucket,
      sources: [s3deploy.Source.asset('data')],
      destinationKeyPrefix: 'seed',
      retainOnDelete: false,
    });

    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}

