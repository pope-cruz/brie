-- Invitation rules: who can invite, invited-email match, expiry, revocation, and replay.
begin;
select plan(22);

insert into auth.users (id, email) values
 ('b1000000-0000-4000-8000-000000000001', 'inv-owner@example.test'),
 ('b1000000-0000-4000-8000-000000000002', 'inv-organizer@example.test'),
 ('b1000000-0000-4000-8000-000000000003', 'invitee@example.test'),
 ('b1000000-0000-4000-8000-000000000004', 'wrong-account@example.test'),
 ('b1000000-0000-4000-8000-000000000005', 'late-invitee@example.test');
insert into public.workspaces (id, name, timezone) values
 ('b1000000-0000-4000-8000-0000000000aa', 'Invitation test', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
 ('b1000000-0000-4000-8000-0000000000aa', 'b1000000-0000-4000-8000-000000000001', 'owner', 'inv-owner@example.test'),
 ('b1000000-0000-4000-8000-0000000000aa', 'b1000000-0000-4000-8000-000000000002', 'organizer', 'inv-organizer@example.test');

set local role authenticated;

-- Organizers cannot manage invitations or see teammate emails.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'someone@example.test', 'member')$$, 'P0001', 'FORBIDDEN', 'Organizer cannot create invitations');
select is(public.list_team('b1000000-0000-4000-8000-0000000000aa')->'invitations', '[]'::jsonb, 'Organizer does not see pending invitations');
select is((select count(*)::int from jsonb_array_elements(public.list_team('b1000000-0000-4000-8000-0000000000aa')->'members') m where m->>'email' is not null), 0, 'Organizer does not see teammate emails');

-- Owner invites.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select set_config('test.token', public.create_invitation('b1000000-0000-4000-8000-0000000000aa', '  Invitee@Example.TEST ', 'member')->>'token', true);
select is(char_length(current_setting('test.token')), 64, 'Owner receives a 256-bit link token');
select is(public.list_team('b1000000-0000-4000-8000-0000000000aa')->'invitations'->0->>'email', 'invitee@example.test', 'Invitation email is normalized');
select throws_ok($$select public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'new-owner@example.test', 'owner')$$, 'P0001', 'VALIDATION', 'Invitations cannot grant ownership');
select throws_ok($$select public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'inv-organizer@example.test', 'member')$$, 'P0001', 'VALIDATION', 'Current members cannot be invited again');

-- Only the invited account can accept.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.accept_invitation(current_setting('test.token'))$$, 'P0001', 'FORBIDDEN', 'A different account cannot accept the invitation');
select throws_ok($$select public.get_workspace('b1000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'UNAVAILABLE', 'The rejected account gains no access');

-- Signed-out visitors can preview but not accept.
set local role anon;
select is(public.peek_invitation(current_setting('test.token'))->>'emailMasked', 'in***@example.test', 'Signed-out preview masks the invited email');
select throws_ok($$select public.accept_invitation(current_setting('test.token'))$$, '42501', 'permission denied for function accept_invitation', 'Signed-out visitors cannot accept');
set local role authenticated;

-- The invited account accepts once.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);
select is(public.accept_invitation(current_setting('test.token'))->>'role', 'member', 'Invited account joins with the invited role');
select is(public.get_workspace('b1000000-0000-4000-8000-0000000000aa')->>'role', 'member', 'New member can open the workspace');
select is(public.accept_invitation(current_setting('test.token'))->>'alreadyMember', 'true', 'Reopening the link as the same member changes nothing');
select throws_ok($$select public.peek_invitation(current_setting('test.token'))$$, 'P0001', 'UNAVAILABLE', 'An accepted link no longer previews');

-- Removal does not let the old link be replayed.
reset role;
update public.memberships set removed_at = now(), version = version + 1
where user_id = 'b1000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.accept_invitation(current_setting('test.token'))$$, 'P0001', 'UNAVAILABLE', 'A used link cannot restore access after removal');

-- Expired links fail.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select set_config('test.late_token', public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'late-invitee@example.test', 'organizer')->>'token', true);
reset role;
update public.invitations set expires_at = now() - interval '1 minute'
where email_normalized = 'late-invitee@example.test' and revoked_at is null;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000005', true);
select throws_ok($$select public.accept_invitation(current_setting('test.late_token'))$$, 'P0001', 'UNAVAILABLE', 'An expired link cannot be accepted');
select throws_ok($$select public.get_workspace('b1000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'UNAVAILABLE', 'An expired link grants no access');

-- Re-inviting replaces the earlier link.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select set_config('test.old_token', public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'late-invitee@example.test', 'member')->>'token', true);
select set_config('test.new_token', public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'late-invitee@example.test', 'organizer')->>'token', true);
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000005', true);
select throws_ok($$select public.accept_invitation(current_setting('test.old_token'))$$, 'P0001', 'UNAVAILABLE', 'Re-inviting revokes the earlier link');
select is(public.accept_invitation(current_setting('test.new_token'))->>'role', 'organizer', 'The newest link works');

-- Only the owner can revoke, and revoked links fail.
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select set_config('test.revoked', public.create_invitation('b1000000-0000-4000-8000-0000000000aa', 'wrong-account@example.test', 'member')::text, true);
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.revoke_invitation((current_setting('test.revoked')::jsonb->>'id')::uuid)$$, 'P0001', 'FORBIDDEN', 'Organizer cannot revoke invitations');
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.revoke_invitation((current_setting('test.revoked')::jsonb->>'id')::uuid);
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.accept_invitation(current_setting('test.revoked')::jsonb->>'token')$$, 'P0001', 'UNAVAILABLE', 'A revoked link cannot be accepted');

reset role;
select * from finish();
rollback;
