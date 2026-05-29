import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
    input: 'http://localhost:3000/swagger/v1/swagger.json', // backend needs to run
    output: 'src/client',
    plugins: [
        '@tanstack/react-query'
    ]
});