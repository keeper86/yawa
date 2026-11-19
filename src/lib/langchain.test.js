import { expect, test } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda } from '@langchain/core/runnables';

test('LangChain formats a prompt and returns the response as text', async () => {
    const prompt = ChatPromptTemplate.fromMessages([
        ['system', 'Summarize the message in one sentence.'],
        ['human', '{message}'],
    ]);

    const fakeModel = RunnableLambda.from((input) => {
        const messages = input.toChatMessages();

        expect(messages.map((message) => message.content)).toEqual([
            'Summarize the message in one sentence.',
            'The team meeting was moved to Thursday.',
        ]);

        return new AIMessage('The meeting is on Thursday.');
    });

    const chain = prompt.pipe(fakeModel).pipe(new StringOutputParser());
    const result = await chain.invoke({
        message: 'The team meeting was moved to Thursday.',
    });

    expect(result).toBe('The meeting is on Thursday.');
});
