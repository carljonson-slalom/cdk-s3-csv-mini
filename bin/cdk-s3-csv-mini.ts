#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkS3CsvStack } from '../lib/cdk-s3-csv-mini-stack';

const app = new cdk.App();
new CdkS3CsvStack(app, 'CdkS3CsvStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});