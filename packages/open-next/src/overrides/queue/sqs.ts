import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

import type { Queue } from "@opennextjs/core/types/overrides.js";

import { awsLogger } from "@opennextjs/core/adapters/logger.js";

// Expected environment variables
const { REVALIDATION_QUEUE_REGION, REVALIDATION_QUEUE_URL } = process.env;

const sqsClient = new SQSClient({
	region: REVALIDATION_QUEUE_REGION,
	logger: awsLogger,
});

const queue: Queue = {
	send: async ({ MessageBody, MessageDeduplicationId, MessageGroupId }) => {
		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: REVALIDATION_QUEUE_URL,
				MessageBody: JSON.stringify(MessageBody),
				MessageDeduplicationId,
				MessageGroupId,
			})
		);
	},
	name: "sqs",
};

export default queue;
