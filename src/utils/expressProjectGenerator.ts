/**
 * Express Project Generator
 *
 * Generates a complete, runnable Express.js project from .http files.
 * Creates a project structure compatible with generator-express-no-stress patterns:
 * - OpenAPI spec in server/common/api.yaml
 * - Route handlers in server/routes/
 * - Services/implementations in server/services/
 * - Full TypeScript support with proper types
 *
 * This provides a complete pipeline: .http → IR → OpenAPI + Express → Running Server
 */

import * as path from 'path';
import { HttpFileIR, OperationIR } from './operationIR';
import { OpenAPIGenerator, OpenAPIGeneratorOptions, OpenAPIDocument } from './openApiGenerator';
import { ExpressGenerator, ExpressGeneratorOptions } from './expressGenerator';
import * as yaml from 'js-yaml';
import { AiServiceGenerationOptions, generateServiceBodies } from './aiServiceGenerator';

// ============================================================================
// Types
// ============================================================================

export interface ProjectGeneratorOptions {
    /** Project name (used for package.json) */
    projectName: string;
    /** Project description */
    description?: string;
    /** Project version */
    version?: string;
    /** Base path for API routes (default: '/api/v1') */
    apiBasePath?: string;
    /** Port for the server (default: 3000) */
    port?: number;
    /** Whether to generate TypeScript (default: true) */
    typescript?: boolean;
    /** OpenAPI generator options */
    openApiOptions?: Partial<OpenAPIGeneratorOptions>;
    /** Express generator options */
    expressOptions?: Partial<ExpressGeneratorOptions>;
    /** Whether to include Docker support (default: true) */
    includeDocker?: boolean;
    /** Whether to include tests (default: true) */
    includeTests?: boolean;
    /** Whether to include API explorer/Swagger UI (default: true) */
    includeApiExplorer?: boolean;
    /** Node.js version for engines (default: '>=18.0.0') */
    nodeVersion?: string;
}

export interface GeneratedFile {
    /** Relative path from project root */
    path: string;
    /** File content */
    content: string;
}

export interface GeneratedProject {
    /** All generated files */
    files: GeneratedFile[];
    /** Project name */
    projectName: string;
    /** Instructions for running the project */
    instructions: string;
}

// ============================================================================
// Project Generator
// ============================================================================

export class ExpressProjectGenerator {
    private readonly options: Required<ProjectGeneratorOptions>;

    constructor(options: ProjectGeneratorOptions) {
        this.options = {
            projectName: options.projectName,
            description: options.description ?? `API generated from .http file`,
            version: options.version ?? '1.0.0',
            apiBasePath: options.apiBasePath ?? '/api/v1',
            port: options.port ?? 3000,
            typescript: options.typescript ?? true,
            openApiOptions: options.openApiOptions ?? {},
            expressOptions: options.expressOptions ?? {},
            includeDocker: options.includeDocker ?? true,
            includeTests: options.includeTests ?? true,
            includeApiExplorer: options.includeApiExplorer ?? true,
            nodeVersion: options.nodeVersion ?? '>=18.0.0',
        };
    }

    /**
     * Generate a complete Express project from HttpFileIR.
     */
    generate(fileIR: HttpFileIR, serviceBodies?: Record<string, string>): GeneratedProject {
        const files: GeneratedFile[] = [];

        // Generate OpenAPI spec
        const openApiGenerator = new OpenAPIGenerator({
            title: this.options.projectName,
            version: this.options.version,
            description: this.options.description,
            stripBaseUrl: true,
            ...this.options.openApiOptions,
        });
        const openApiDoc = openApiGenerator.generate(fileIR);

        // Generate Express code
        const expressGenerator = new ExpressGenerator({
            typescript: this.options.typescript,
            asyncHandlers: true,
            generateValidation: false, // Let express-openapi-validator handle this
            generateImplementationHooks: true,
            routeStyle: 'router',
            basePath: '',
            implModulePath: '../services',
            ...this.options.expressOptions,
        });

        // Core project files
        files.push(this.generatePackageJson());
        files.push(this.generateTsConfig());
        files.push(this.generateEnvFile());
        files.push(this.generateEnvExample());
        files.push(this.generateGitignore());

        // OpenAPI spec
        files.push({
            path: 'server/common/api.yaml',
            content: yaml.dump(openApiDoc, { indent: 2, lineWidth: -1, noRefs: true }),
        });

        // Server entry point
        files.push(this.generateServerIndex());
        files.push(this.generateApp(fileIR));

        // Routes
        files.push(this.generateRoutes(fileIR, expressGenerator));

        // Controllers (one per operation)
        for (const op of fileIR.operations) {
            files.push(this.generateController(op));
        }

        // Services (implementation stubs)
        files.push(...this.generateServices(fileIR, serviceBodies));

        // Common utilities
        files.push(this.generateLogger());
        files.push(this.generateErrorHandler());

        // OpenAPI validator setup
        files.push(this.generateOpenApiValidator());

        // Optional: Docker
        if (this.options.includeDocker) {
            files.push(this.generateDockerfile());
            files.push(this.generateDockerCompose());
            files.push(this.generateDockerignore());
        }

        // Optional: Tests
        if (this.options.includeTests) {
            files.push(this.generateTestSetup());
            for (const op of fileIR.operations) {
                files.push(this.generateTest(op));
            }
        }

        // README
        files.push(this.generateReadme(fileIR));

        const instructions = this.generateInstructions();

        return {
            files,
            projectName: this.options.projectName,
            instructions,
        };
    }

    // ========================================================================
    // Package.json
    // ========================================================================

    private generatePackageJson(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const pkg = {
            name: this.options.projectName,
            version: this.options.version,
            description: this.options.description,
            main: this.options.typescript ? 'dist/index.js' : 'server/index.js',
            scripts: {
                ...(this.options.typescript ? {
                    'build': 'tsc',
                    'start': 'node dist/index.js',
                    'dev': 'ts-node-dev --respawn --transpile-only server/index.ts',
                    'dev:debug': 'ts-node-dev --respawn --transpile-only --inspect server/index.ts',
                } : {
                    'start': 'node server/index.js',
                    'dev': 'nodemon server/index.js',
                }),
                'lint': 'eslint .',
                'lint:fix': 'eslint . --fix',
                ...(this.options.includeTests ? {
                    'test': 'jest',
                    'test:watch': 'jest --watch',
                    'test:coverage': 'jest --coverage',
                } : {}),
            },
            engines: {
                node: this.options.nodeVersion,
            },
            dependencies: {
                'express': '^4.18.2',
                'express-openapi-validator': '^5.1.0',
                'cors': '^2.8.5',
                'helmet': '^7.1.0',
                'pino': '^8.17.0',
                'pino-http': '^8.6.0',
                'dotenv': '^16.3.1',
                ...(this.options.includeApiExplorer ? {
                    'swagger-ui-express': '^5.0.0',
                    'yamljs': '^0.3.0',
                } : {}),
            },
            devDependencies: {
                ...(this.options.typescript ? {
                    'typescript': '^5.3.0',
                    'ts-node-dev': '^2.0.0',
                    '@types/node': '^20.10.0',
                    '@types/express': '^4.17.21',
                    '@types/cors': '^2.8.17',
                    '@types/swagger-ui-express': '^4.1.6',
                    '@types/yamljs': '^0.2.34',
                } : {
                    'nodemon': '^3.0.2',
                }),
                'eslint': '^8.55.0',
                ...(this.options.includeTests ? {
                    'jest': '^29.7.0',
                    'supertest': '^6.3.3',
                    '@types/jest': '^29.5.11',
                    '@types/supertest': '^2.0.16',
                    ...(this.options.typescript ? { 'ts-jest': '^29.1.1' } : {}),
                } : {}),
            },
        };

        return {
            path: 'package.json',
            content: JSON.stringify(pkg, null, 2),
        };
    }

    // ========================================================================
    // TypeScript Config
    // ========================================================================

    private generateTsConfig(): GeneratedFile {
        if (!this.options.typescript) {
            return { path: '', content: '' };
        }

        const config = {
            compilerOptions: {
                target: 'ES2022',
                module: 'commonjs',
                lib: ['ES2022'],
                outDir: './dist',
                rootDir: './server',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                resolveJsonModule: true,
                declaration: true,
                declarationMap: true,
                sourceMap: true,
            },
            include: ['server/**/*'],
            exclude: ['node_modules', 'dist'],
        };

        return {
            path: 'tsconfig.json',
            content: JSON.stringify(config, null, 2),
        };
    }

    // ========================================================================
    // Environment Files
    // ========================================================================

    private generateEnvFile(): GeneratedFile {
        return {
            path: '.env',
            content: `# Server Configuration
PORT=${this.options.port}
NODE_ENV=development

# API Configuration
API_BASE_PATH=${this.options.apiBasePath}

# OpenAPI Validation
OPENAPI_ENABLE_RESPONSE_VALIDATION=false

# Logging
LOG_LEVEL=info
`,
        };
    }

    private generateEnvExample(): GeneratedFile {
        return {
            path: '.env.example',
            content: `# Server Configuration
PORT=${this.options.port}
NODE_ENV=development

# API Configuration
API_BASE_PATH=${this.options.apiBasePath}

# OpenAPI Validation
OPENAPI_ENABLE_RESPONSE_VALIDATION=false

# Logging
LOG_LEVEL=info
`,
        };
    }

    // ========================================================================
    // Server Entry Point
    // ========================================================================

    private generateServerIndex(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const content = `import 'dotenv/config';
import app from './app';
import logger from './common/logger';

const port = process.env.PORT || ${this.options.port};

app.listen(port, () => {
  logger.info(\`Server started on port \${port}\`);
  logger.info(\`API available at http://localhost:\${port}${this.options.apiBasePath}\`);
  ${this.options.includeApiExplorer ? `logger.info(\`API Explorer available at http://localhost:\${port}/api-explorer\`);` : ''}
});
`;

        return {
            path: `server/index.${ext}`,
            content,
        };
    }

    // ========================================================================
    // Express App
    // ========================================================================

    private generateApp(fileIR: HttpFileIR): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const content = `import express${this.options.typescript ? ', { Application }' : ''} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
${this.options.includeApiExplorer ? `import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';` : ''}
import logger from './common/logger';
import { openApiValidator } from './common/openApiValidator';
import { errorHandler } from './common/errorHandler';
import routes from './routes';

const app${this.options.typescript ? ': Application' : ''} = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(pinoHttp({ logger }));

${this.options.includeApiExplorer ? `// API Explorer (Swagger UI)
const apiSpec = YAML.load(path.join(__dirname, 'common/api.yaml'));
app.use('/api-explorer', swaggerUi.serve, swaggerUi.setup(apiSpec));
app.get('/api-spec', (req, res) => res.json(apiSpec));
` : ''}

// OpenAPI validation
app.use(openApiValidator);

// API routes
app.use('${this.options.apiBasePath}', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

export default app;
`;

        return {
            path: `server/app.${ext}`,
            content,
        };
    }

    // ========================================================================
    // Routes
    // ========================================================================

    private generateRoutes(fileIR: HttpFileIR, expressGenerator: ExpressGenerator): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const lines: string[] = [];

        lines.push(`import { Router } from 'express';`);

        // Import controllers
        for (const op of fileIR.operations) {
            lines.push(`import { ${op.name}Controller } from './controllers/${op.name}';`);
        }

        lines.push('');
        lines.push('const router = Router();');
        lines.push('');

        // Register routes
        for (const op of fileIR.operations) {
            const path = this.extractPath(op.urlTemplate);
            const method = op.method.toLowerCase();
            lines.push(`// ${op.method} ${path}`);
            lines.push(`router.${method}('${path}', ${op.name}Controller);`);
            lines.push('');
        }

        lines.push('export default router;');

        return {
            path: `server/routes/index.${ext}`,
            content: lines.join('\n'),
        };
    }

    // ========================================================================
    // Controllers
    // ========================================================================

    private generateController(op: OperationIR): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const pascalName = this.toPascalCase(op.name);
        const lines: string[] = [];

        if (this.options.typescript) {
            lines.push(`import { Request, Response, NextFunction } from 'express';`);
        }
        lines.push(`import { ${op.name}Service } from '../services/${op.name}';`);
        lines.push(`import logger from '../common/logger';`);
        lines.push('');

        // Generate request/response types
        if (this.options.typescript) {
            lines.push(this.generateControllerTypes(op));
            lines.push('');
        }

        // Controller function
        const reqType = this.options.typescript ? ': Request' : '';
        const resType = this.options.typescript ? ': Response' : '';
        const nextType = this.options.typescript ? ': NextFunction' : '';

        lines.push(`/**`);
        lines.push(` * ${op.method} ${this.extractPath(op.urlTemplate)}`);
        lines.push(` * Controller for ${op.name}`);
        lines.push(` */`);
        lines.push(`export async function ${op.name}Controller(req${reqType}, res${resType}, next${nextType}) {`);
        lines.push(`  try {`);
        lines.push(`    logger.info({ operation: '${op.name}' }, 'Processing request');`);
        lines.push('');

        // Extract parameters
        lines.push(`    // Extract request data`);
        lines.push(...this.generateParameterExtraction(op, '    '));
        lines.push('');

        // Call service
        lines.push(`    // Call service`);
        lines.push(`    const result = await ${op.name}Service(request);`);
        lines.push('');

        // Send response
        lines.push(`    // Send response`);
        if (op.outputs.length > 0) {
            lines.push(`    res.json(result);`);
        } else {
            lines.push(`    res.status(result.status || 200).json(result.body || result);`);
        }

        lines.push(`  } catch (error) {`);
        lines.push(`    logger.error({ error, operation: '${op.name}' }, 'Request failed');`);
        lines.push(`    next(error);`);
        lines.push(`  }`);
        lines.push(`}`);

        return {
            path: `server/controllers/${op.name}.${ext}`,
            content: lines.join('\n'),
        };
    }

    private generateControllerTypes(op: OperationIR): string {
        const pascalName = this.toPascalCase(op.name);
        const lines: string[] = [];

        // Request type
        lines.push(`export interface ${pascalName}Request {`);

        const pathParams = op.inputs.filter(i => i.source === 'path');
        if (pathParams.length > 0) {
            lines.push(`  params: {`);
            for (const p of pathParams) {
                lines.push(`    ${p.name}: string;`);
            }
            lines.push(`  };`);
        }

        const queryParams = op.inputs.filter(i => i.source === 'query');
        if (queryParams.length > 0) {
            lines.push(`  query: {`);
            for (const p of queryParams) {
                lines.push(`    ${p.name}?: string;`);
            }
            lines.push(`  };`);
        }

        if (op.body.kind !== 'none') {
            lines.push(`  body: Record<string, unknown>;`);
        }

        const headerParams = op.inputs.filter(i => i.source === 'header');
        if (headerParams.length > 0) {
            lines.push(`  headers: {`);
            for (const p of headerParams) {
                lines.push(`    ${this.toValidIdentifier(p.name)}?: string;`);
            }
            lines.push(`  };`);
        }

        lines.push(`}`);

        return lines.join('\n');
    }

    private generateParameterExtraction(op: OperationIR, indent: string): string[] {
        const lines: string[] = [];
        const parts: string[] = [];

        const pathParams = op.inputs.filter(i => i.source === 'path');
        if (pathParams.length > 0) {
            parts.push(`params: req.params`);
        }

        const queryParams = op.inputs.filter(i => i.source === 'query');
        if (queryParams.length > 0) {
            parts.push(`query: req.query`);
        }

        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            parts.push(`body: req.body`);
        }

        const headerParams = op.inputs.filter(i => i.source === 'header');
        if (headerParams.length > 0) {
            const headerObj = headerParams
                .map(p => `${this.toValidIdentifier(p.name)}: req.get('${p.name.toLowerCase()}')`)
                .join(', ');
            parts.push(`headers: { ${headerObj} }`);
        }

        if (parts.length > 0) {
            lines.push(`${indent}const request = {`);
            for (const part of parts) {
                lines.push(`${indent}  ${part},`);
            }
            lines.push(`${indent}};`);
        } else {
            lines.push(`${indent}const request = {};`);
        }

        return lines;
    }

    // ========================================================================
    // Services
    // ========================================================================

    private generateServices(fileIR: HttpFileIR, serviceBodies?: Record<string, string>): GeneratedFile[] {
        const ext = this.options.typescript ? 'ts' : 'js';
        const files: GeneratedFile[] = [];
        const lines: string[] = [];

        lines.push(`/**`);
        lines.push(` * Service implementations`);
        lines.push(` * TODO: Implement your business logic here`);
        lines.push(` */`);
        lines.push('');

        for (const op of fileIR.operations) {
            const pascalName = this.toPascalCase(op.name);

            if (this.options.typescript) {
                lines.push(`import type { ${pascalName}Request } from '../controllers/${op.name}';`);
            }
        }

        lines.push('');

        for (const op of fileIR.operations) {
            const pascalName = this.toPascalCase(op.name);
            const reqType = this.options.typescript ? `: ${pascalName}Request` : '';
            const retType = this.options.typescript ? `: Promise<${this.getResponseType(op)}>` : '';

            lines.push(`/**`);
            lines.push(` * Service for ${op.name}`);
            lines.push(` * ${op.method} ${this.extractPath(op.urlTemplate)}`);
            lines.push(` */`);
            lines.push(`export async function ${op.name}Service(request${reqType})${retType} {`);

            const generatedBody = this.formatGeneratedBody(serviceBodies?.[op.name]);
            if (generatedBody) {
                for (const line of generatedBody) {
                    lines.push(`  ${line}`);
                }
            } else {
                lines.push(`  // TODO: Implement business logic`);

                if (op.outputs.length > 0) {
                    lines.push(`  return {`);
                    for (const output of op.outputs) {
                        lines.push(`    ${output.name}: undefined, // TODO: implement`);
                    }
                    lines.push(`  };`);
                } else {
                    lines.push(`  return {`);
                    lines.push(`    status: 200,`);
                    lines.push(`    body: { message: 'Not implemented' },`);
                    lines.push(`  };`);
                }
            }

            lines.push(`}`);
            lines.push('');

            files.push({
                path: `server/services/${op.name}.${ext}`,
                content: `export { ${op.name}Service } from './index';\n`,
            });
        }

        files.unshift({
            path: `server/services/index.${ext}`,
            content: lines.join('\n'),
        });

        return files;
    }

    private getResponseType(op: OperationIR): string {
        if (op.outputs.length > 0) {
            const fields = op.outputs.map(o => `${o.name}: unknown`).join('; ');
            return `{ ${fields} }`;
        }
        return `{ status?: number; body?: unknown }`;
    }

    private formatGeneratedBody(body: string | undefined): string[] | undefined {
        if (!body) {
            return undefined;
        }
        const trimmed = body.trim();
        if (!trimmed) {
            return undefined;
        }
        return trimmed.split(/\r?\n/);
    }

    // ========================================================================
    // Common Utilities
    // ========================================================================

    private generateLogger(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        return {
            path: `server/common/logger.${ext}`,
            content: `import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  } : undefined,
});

export default logger;
`,
        };
    }

    private generateErrorHandler(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const reqType = this.options.typescript ? ': Request' : '';
        const resType = this.options.typescript ? ': Response' : '';
        const nextType = this.options.typescript ? ': NextFunction' : '';
        const errType = this.options.typescript ? ': unknown' : '';

        return {
            path: `server/common/errorHandler.${ext}`,
            content: `${this.options.typescript ? `import { Request, Response, NextFunction } from 'express';\n` : ''}import logger from './logger';

export function errorHandler(err${errType}, req${reqType}, res${resType}, next${nextType}) {
  logger.error({ err }, 'Unhandled error');

  // OpenAPI validation errors
  if (err && typeof err === 'object' && 'status' in err) {
    const error = err as { status: number; message: string; errors?: unknown[] };
    return res.status(error.status).json({
      error: {
        message: error.message,
        errors: error.errors,
      },
    });
  }

  // Generic errors
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({
    error: {
      message,
    },
  });
}
`,
        };
    }

    private generateOpenApiValidator(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        return {
            path: `server/common/openApiValidator.${ext}`,
            content: `import * as OpenApiValidator from 'express-openapi-validator';
import path from 'path';

export const openApiValidator = OpenApiValidator.middleware({
  apiSpec: path.join(__dirname, 'api.yaml'),
  validateRequests: true,
  validateResponses: process.env.OPENAPI_ENABLE_RESPONSE_VALIDATION === 'true',
});
`,
        };
    }

    // ========================================================================
    // Docker
    // ========================================================================

    private generateDockerfile(): GeneratedFile {
        return {
            path: 'Dockerfile',
            content: `FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

${this.options.typescript ? `# Build TypeScript
RUN npm run build

` : ''}# Expose port
EXPOSE ${this.options.port}

# Start server
CMD ["npm", "start"]
`,
        };
    }

    private generateDockerCompose(): GeneratedFile {
        return {
            path: 'docker-compose.yml',
            content: `version: '3.8'

services:
  api:
    build: .
    ports:
      - "${this.options.port}:${this.options.port}"
    environment:
      - NODE_ENV=production
      - PORT=${this.options.port}
    restart: unless-stopped
`,
        };
    }

    private generateDockerignore(): GeneratedFile {
        return {
            path: '.dockerignore',
            content: `node_modules
npm-debug.log
.env
.env.local
dist
coverage
.git
.gitignore
README.md
`,
        };
    }

    // ========================================================================
    // Tests
    // ========================================================================

    private generateTestSetup(): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        return {
            path: `server/__tests__/setup.${ext}`,
            content: `import app from '../app';

export { app };

// Test utilities
export async function request(method: string, path: string, body?: unknown) {
  const supertest = require('supertest');
  const req = supertest(app)[method.toLowerCase()](path);
  if (body) {
    req.send(body);
  }
  return req;
}
`,
        };
    }

    private generateTest(op: OperationIR): GeneratedFile {
        const ext = this.options.typescript ? 'ts' : 'js';
        const path = this.extractPath(op.urlTemplate);
        const fullPath = `${this.options.apiBasePath}${path}`;

        return {
            path: `server/__tests__/${op.name}.test.${ext}`,
            content: `import request from 'supertest';
import app from '../app';

describe('${op.name}', () => {
  describe('${op.method} ${path}', () => {
    it('should return a response', async () => {
      const response = await request(app)
        .${op.method.toLowerCase()}('${fullPath.replace(/:\w+/g, 'test')}')
        ${op.body.kind !== 'none' ? `.send({})` : ''}
        .expect('Content-Type', /json/);

      // TODO: Add specific assertions
      expect(response.status).toBeDefined();
    });

    // TODO: Add more test cases
  });
});
`,
        };
    }

    // ========================================================================
    // Misc Files
    // ========================================================================

    private generateGitignore(): GeneratedFile {
        return {
            path: '.gitignore',
            content: `# Dependencies
node_modules/

# Build output
dist/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Coverage
coverage/

# Misc
*.swp
*.swo
`,
        };
    }

    private generateReadme(fileIR: HttpFileIR): GeneratedFile {
        const operations = fileIR.operations
            .map(op => `- \`${op.method} ${this.extractPath(op.urlTemplate)}\` - ${op.name}`)
            .join('\n');

        return {
            path: 'README.md',
            content: `# ${this.options.projectName}

${this.options.description}

## Getting Started

### Prerequisites

- Node.js ${this.options.nodeVersion}
- npm or yarn

### Installation

\`\`\`bash
npm install
\`\`\`

### Development

\`\`\`bash
npm run dev
\`\`\`

The server will start at http://localhost:${this.options.port}

${this.options.includeApiExplorer ? `### API Explorer

Visit http://localhost:${this.options.port}/api-explorer to view the interactive API documentation.
` : ''}
### Production

\`\`\`bash
${this.options.typescript ? 'npm run build\n' : ''}npm start
\`\`\`

${this.options.includeTests ? `### Testing

\`\`\`bash
npm test
\`\`\`
` : ''}
${this.options.includeDocker ? `### Docker

\`\`\`bash
docker-compose up -d
\`\`\`
` : ''}
## API Endpoints

${operations}

## Project Structure

\`\`\`
├── server/
│   ├── common/
│   │   ├── api.yaml        # OpenAPI specification
│   │   ├── logger.ts       # Pino logger
│   │   ├── errorHandler.ts # Error handling middleware
│   │   └── openApiValidator.ts
│   ├── controllers/        # Route handlers
│   ├── routes/             # Route definitions
│   ├── services/           # Business logic
│   ├── app.ts              # Express app setup
│   └── index.ts            # Server entry point
├── package.json
└── tsconfig.json
\`\`\`

## Generated with Restive Client

This project was generated from a .http file using [Restive Client](https://github.com/egoughnour/vscode-restiveclient).
`,
        };
    }

    private generateInstructions(): string {
        return `
Project generated successfully!

Next steps:
1. cd ${this.options.projectName}
2. npm install
3. npm run dev

The server will start at http://localhost:${this.options.port}
${this.options.includeApiExplorer ? `API Explorer: http://localhost:${this.options.port}/api-explorer` : ''}

To implement your business logic, edit the files in server/services/
`;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private extractPath(urlTemplate: string): string {
        let url = urlTemplate;

        // Strip {{baseUrl}}
        url = url.replace(/^\{\{(\w*[Bb]ase[Uu]rl\w*)\}\}/, '');

        // Remove protocol and host
        try {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
                url = url.slice(`${urlObj.protocol}//${urlObj.host}`.length);
            }
        } catch {
            // Continue with original
        }

        // Convert {{variable}} to :variable
        let path = url.replace(/\{\{(\w+)\}\}/g, ':$1');

        // Ensure leading slash
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        // Remove query string
        const queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.slice(0, queryIndex);
        }

        return path;
    }

    private toPascalCase(str: string): string {
        return str
            .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
            .replace(/^(.)/, (_, c) => c.toUpperCase());
    }

    private toValidIdentifier(str: string): string {
        return str
            .replace(/-/g, '_')
            .replace(/[^a-zA-Z0-9_$]/g, '_')
            .replace(/^(\d)/, '_$1');
    }

    private methodSupportsBody(method: string): boolean {
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate a complete Express project from HttpFileIR.
 */
export function generateExpressProject(
    fileIR: HttpFileIR,
    options: ProjectGeneratorOptions
): GeneratedProject {
    const generator = new ExpressProjectGenerator(options);
    return generator.generate(fileIR);
}

/**
 * Generate a complete Express project using AI-generated service bodies.
 */
export async function generateExpressProjectWithAi(
    fileIR: HttpFileIR,
    options: ProjectGeneratorOptions,
    aiOptions: AiServiceGenerationOptions
): Promise<GeneratedProject> {
    const generator = new ExpressProjectGenerator(options);
    const language = options.typescript === false ? 'javascript' : 'typescript';
    const serviceBodies = await generateServiceBodies(fileIR, {
        ...aiOptions,
        language,
    });
    return generator.generate(fileIR, serviceBodies);
}

/**
 * Generate project and write files to disk.
 */
export async function generateAndWriteProject(
    fileIR: HttpFileIR,
    options: ProjectGeneratorOptions,
    outputDir: string
): Promise<GeneratedProject> {
    const fs = await import('fs-extra');
    const pathModule = await import('path');

    const project = generateExpressProject(fileIR, options);

    // Write each file
    for (const file of project.files) {
        if (!file.path) continue; // Skip empty paths (like tsconfig when not using TS)

        const fullPath = pathModule.join(outputDir, project.projectName, file.path);
        await fs.ensureDir(pathModule.dirname(fullPath));
        await fs.writeFile(fullPath, file.content);
    }

    return project;
}

/**
 * Generate project with AI-generated service bodies and write files to disk.
 */
export async function generateAndWriteProjectWithAi(
    fileIR: HttpFileIR,
    options: ProjectGeneratorOptions,
    aiOptions: AiServiceGenerationOptions,
    outputDir: string
): Promise<GeneratedProject> {
    const fs = await import('fs-extra');
    const pathModule = await import('path');

    const project = await generateExpressProjectWithAi(fileIR, options, aiOptions);

    for (const file of project.files) {
        if (!file.path) continue;

        const fullPath = pathModule.join(outputDir, project.projectName, file.path);
        await fs.ensureDir(pathModule.dirname(fullPath));
        await fs.writeFile(fullPath, file.content);
    }

    return project;
}
