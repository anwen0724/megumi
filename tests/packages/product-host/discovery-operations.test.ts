/*
 * Verifies the Recommendation Product Host delegates authoritative interests and versioned settings.
 */
// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {RecommendationConfigurationViewSchema} from '@megumi/application/contracts';
import {composeTestApplication,type TestApplication} from '../composition/compose-test-application';
let application:TestApplication|undefined;
afterEach(async()=>{await application?.cleanup();application=undefined;});
describe('Recommendation Product Host operations',()=>{
 it('creates, edits, pauses, resumes and deletes an interest through its explicit operations',async()=>{
  application=composeTestApplication();const host=application.runtime.recommendation;
  expect(await host.listInterests()).toEqual({interests:[]});
  const {interest}=await host.createInterest({text:'TypeScript architecture'});
  expect(interest).toMatchObject({text:'TypeScript architecture',enabled:true,revision:1});
  expect(await host.updateInterest({interestId:interest.id,expectedRevision:1,text:'TypeScript module design'})).toMatchObject({status:'updated',interest:{revision:2}});
  expect(await host.updateInterest({interestId:interest.id,expectedRevision:2,enabled:false})).toMatchObject({status:'updated',interest:{enabled:false,revision:3}});
  expect(await host.updateInterest({interestId:interest.id,expectedRevision:3,enabled:true})).toMatchObject({status:'updated',interest:{enabled:true,revision:4}});
  expect(await host.deleteInterest({interestId:interest.id,expectedRevision:4})).toEqual({status:'deleted'});
  expect(await host.deleteInterest({interestId:interest.id,expectedRevision:4})).toEqual({status:'already_deleted'});
  expect(await host.listInterests()).toEqual({interests:[]});
 });
 it('distinguishes invalid input, missing interest and revision conflicts without inventing saved state',async()=>{
  application=composeTestApplication();const host=application.runtime.recommendation;
  await expect(host.createInterest({text:'   '})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(host.updateInterest({interestId:'missing',expectedRevision:1,text:'Anything'})).rejects.toMatchObject({code:'INTEREST_NOT_FOUND'});
  await expect(host.updateInterest({interestId:'missing',expectedRevision:1,enabled:false})).rejects.toMatchObject({code:'INTEREST_NOT_FOUND'});
  const {interest}=await host.createInterest({text:'Topic'});
  await host.updateInterest({interestId:interest.id,expectedRevision:1,text:'Changed'});
  await expect(host.deleteInterest({interestId:interest.id,expectedRevision:1})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  expect((await host.listInterests()).interests).toHaveLength(1);
 });
 it('reads non-sensitive configuration and rejects a stale configuration update',async()=>{
  application=composeTestApplication();const host=application.runtime.recommendation;
  const initial=RecommendationConfigurationViewSchema.parse(await host.getConfiguration());
  expect(initial.config.enabled).toBe(false);
  expect(initial.sources).toHaveLength(5);
  const updated=await host.updateConfiguration({expectedRevision:initial.revision,changes:{enabledSources:[]}});
  expect(updated.sources.every(source=>!source.enabled&&source.state==='disabled')).toBe(true);
  await expect(host.updateConfiguration({expectedRevision:initial.revision,changes:{enabledSources:['zhihu']}})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  expect(application.runtime.settings.readSettings()).toMatchObject({status:'ok',settings:{config:{discovery:{enabledSources:[]}}}});
 });
 it('enables recommendation through the same versioned settings update and keeps repeated updates idempotent',async()=>{
  application=composeTestApplication();const host=application.runtime.recommendation;
  const initial=await host.getConfiguration();
  const enabled=await host.updateConfiguration({expectedRevision:initial.revision,changes:{enabled:true}});
  expect(enabled.config.enabled).toBe(true);
  const repeated=await host.updateConfiguration({expectedRevision:enabled.revision,changes:{enabled:true}});
  expect(repeated.revision).toBe(enabled.revision);
 });
});
