import { ADMIN, createTestApp, MANAGER, resetDatabase, signIn, type TestContext } from './utils.js';

describe('auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('signs in and returns the current user', async () => {
    const token = await signIn(ctx, ADMIN);
    const me = await ctx.http().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
  });

  it('answers 401 the same way for an unknown email and a wrong password', async () => {
    const unknown = await ctx.http().post('/api/auth/login').send({ email: 'nobody@test.local', password: 'whatever123' });
    const wrong = await ctx.http().post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-pass-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('rejects requests without a valid access token', async () => {
    await ctx.http().get('/api/products').expect(401);
    await ctx.http().get('/api/products').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('rotates refresh tokens and revokes every session when an old one is reused', async () => {
    const first = await ctx.http().post('/api/auth/login').send(ADMIN).expect(200);
    const second = await ctx.http().post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

    // The first token was already used: somebody has a copy of it.
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    // So the newest token of that user is revoked too.
    await ctx.http().post('/api/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('lets only one of two parallel refreshes with the same token succeed', async () => {
    const login = await ctx.http().post('/api/auth/login').send(ADMIN).expect(200);
    const results = await Promise.all([
      ctx.http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }),
      ctx.http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 401]);
  });

  it('forbids admin-only routes for a manager', async () => {
    const token = await signIn(ctx, MANAGER);
    await ctx.http().get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
    await ctx.http().patch('/api/marketplaces/1').set('Authorization', `Bearer ${token}`).send({ isEnabled: false }).expect(403);
  });

  it('lets an admin create a user, and a duplicate email is a 409', async () => {
    const token = await signIn(ctx, ADMIN);
    const body = { email: 'new@test.local', name: 'New', password: 'new-pass-123', role: 'MANAGER' };
    const created = await ctx.http().post('/api/users').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    expect(created.body).not.toHaveProperty('passwordHash');
    await ctx.http().post('/api/users').set('Authorization', `Bearer ${token}`).send(body).expect(409);
  });
});
