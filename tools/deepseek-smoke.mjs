import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

if (!apiKey) {
    console.error('Set DEEPSEEK_API_KEY in .env before running the smoke test.');
    process.exit(1);
}

const model = new ChatOpenAI({
    apiKey,
    configuration: { baseURL: 'https://api.deepseek.com' },
    model: 'deepseek-flash',
    modelKwargs: { thinking: { type: 'disabled' } },
    maxTokens: 32,
    maxRetries: 0,
    timeout: 15_000,
});

try {
    const response = await model.pipe(new StringOutputParser()).invoke('Reply with OK.');

    if (!response.trim()) {
        console.error('DeepSeek returned an empty response.');
        process.exitCode = 1;
    } else {
        console.log('DeepSeek smoke test passed. LangChain received a text response.');
    }
} catch (error) {
    if (Number.isInteger(error?.status)) {
        console.error(`DeepSeek smoke test failed (HTTP ${error.status}).`);
    } else {
        console.error('DeepSeek smoke test could not complete the request. Check the network connection.');
    }
    process.exitCode = 1;
}
