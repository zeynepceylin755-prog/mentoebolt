export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'MENTORA API',
    description: 'MENTORA AI-powered personalized learning platform API',
    version: '1.0.0',
    contact: {
      name: 'MENTORA Team',
      email: 'support@mentora.ai',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000/api/v1',
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Students', description: 'Student management' },
    { name: 'Learning', description: 'Learning session management' },
    { name: 'Assessments', description: 'Assessment management' },
    { name: 'AI', description: 'AI-powered features' },
    { name: 'Analytics', description: 'Learning analytics' },
  ],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  grade: { type: 'number', minimum: 1, maximum: 12 },
                  school: { type: 'string' },
                },
                required: ['email', 'password', 'firstName', 'lastName', 'grade'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'User registered successfully' },
          '400': { description: 'Validation error' },
          '409': { description: 'User already exists' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login to the platform',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful' },
          '401': { description: 'Invalid credentials' },
          '423': { description: 'Account locked' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Tokens refreshed' },
          '401': { description: 'Invalid refresh token' },
        },
      },
    },
  },
};
