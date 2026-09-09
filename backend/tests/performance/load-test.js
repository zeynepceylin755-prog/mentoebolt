import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users
    { duration: '1m', target: 50 },  // Ramp up to 50 users
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '1m', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // Less than 1% failure rate
  },
};

const BASE_URL = 'http://localhost:3000/api/v1';

export default function () {
  // Register
  const registerPayload = JSON.stringify({
    email: `user${__VU}${__ITER}@example.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'User',
    grade: 11,
  });

  const registerRes = http.post(`${BASE_URL}/auth/register`, registerPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(registerRes, {
    'register status is 201': (r) => r.status === 201,
  });

  // Login
  const loginPayload = JSON.stringify({
    email: `user${__VU}${__ITER}@example.com`,
    password: 'Test123!@#',
  });

  const loginRes = http.post(`${BASE_URL}/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
  });

  if (loginRes.status === 200) {
    const token = loginRes.json('data.tokens.accessToken');
    
    // Get profile
    const profileRes = http.get(`${BASE_URL}/students/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    check(profileRes, {
      'profile status is 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
