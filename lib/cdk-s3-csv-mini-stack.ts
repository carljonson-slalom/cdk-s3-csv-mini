import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';

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

    // --- Glue catalog and crawler setup ---
    const glueDatabaseName = `${this.stackName.toLowerCase()}_db`;
    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: glueDatabaseName,
      },
    });

    // IAM role for Glue crawler
    const crawlerRole = new iam.Role(this, 'GlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'Role for Glue crawler to access S3 data and write to Glue Data Catalog',
    });
    crawlerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'));
    // allow read to the data prefix and write to the Glue catalog (the managed policy covers Glue actions)
    bucket.grantRead(crawlerRole);

    // Glue crawler
    const crawler = new glue.CfnCrawler(this, 'GlueCrawler', {
      name: `${this.stackName}-crawler`,
      role: crawlerRole.roleArn,
      databaseName: glueDatabaseName,
      targets: {
        s3Targets: [{ path: `s3://${bucket.bucketName}/seed/` }],
      },
      tablePrefix: 'seed_',
    });
    crawler.addDependsOn(glueDatabase);

    // --- Athena WorkGroup ---
    const resultsPrefix = `athena-results/`;
    const athenaOutputLocation = `s3://${bucket.bucketName}/${resultsPrefix}`;

    const workGroup = new athena.CfnWorkGroup(this, 'AthenaWorkGroup', {
      name: `${this.stackName}-wg`,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: athenaOutputLocation,
        },
      },
      description: 'WorkGroup for querying CSV data via Athena',
    });

  new cdk.CfnOutput(this, 'GlueDatabaseName', { value: glueDatabaseName });
    new cdk.CfnOutput(this, 'AthenaQueryResults', { value: athenaOutputLocation });
  }
}

