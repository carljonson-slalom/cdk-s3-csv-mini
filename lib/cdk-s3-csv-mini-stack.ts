import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as cr from 'aws-cdk-lib/custom-resources';

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

    // Create a role that GitHub Actions can assume via OIDC for CDK deploy (matches workflow role-to-assume)
    // Note: For simplicity this role is given AdministratorAccess so CDK can bootstrap and deploy without missing permissions.
    // In production you should restrict permissions to least-privilege.
    const oidcRoleName = 'github-oidc-cdk-deploy';
    const oidcProviderArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;

    const assumeRolePolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: oidcProviderArn },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringLike: {
              'token.actions.githubusercontent.com:sub': `repo:${this.node.tryGetContext('githubRepo') || (this.account && 'carljonson-slalom/cdk-s3-csv-mini')}:*`
            },
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com'
            }
          }
        }
      ]
    };

    const oidcRole = new iam.CfnRole(this, 'GitHubOidcRole', {
      roleName: oidcRoleName,
      assumeRolePolicyDocument: assumeRolePolicy,
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/AdministratorAccess'
      ],
      description: 'Role assumable by GitHub Actions OIDC for CDK deploy'
    });

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

    // Start the Glue crawler after deployment using a custom resource
    const crawlerArn = `arn:aws:glue:${this.region}:${this.account}:crawler/${this.stackName}-crawler`;
    const startCrawler = new cr.AwsCustomResource(this, 'StartGlueCrawler', {
      onCreate: {
        service: 'Glue',
        action: 'startCrawler',
        parameters: { Name: `${this.stackName}-crawler` },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.stackName}-crawler-started`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['glue:StartCrawler', 'glue:GetCrawler'], resources: [crawlerArn] }),
      ]),
    });
    startCrawler.node.addDependency(crawler);
  }
}

