import NodeEditDialog from '@/components/shared/NodeEditDialog';
import RecurrenceSwitch from '@/components/node-dialog/sections/RecurrenceSwitch';
import RulesDialog from '@/components/rules/RulesDialog';
import NodeRulesPanel from '@/components/rules/NodeRulesPanel';
import UnblockRulesHint from '@/components/rules/UnblockRulesHint';
import NodeTasksDialog from '@/components/tasks/NodeTasksDialog';
import SaveTemplateDialog from '@/components/shared/SaveTemplateDialog';
import SkinDialog from '@/components/shared/SkinDialog';
import ShareDialog from '@/components/goal-map/ShareDialog';
import AdvisorDialog from '@/components/goal-map/AdvisorDialog';
import AIChatPanel from '@/components/goal-map/AIChatPanel';

// Dialogy editoru na konci stromu (úprava uzlu, pravidla, úkoly uzlu, šablona,
// vzhled, sdílení, AI poradce, AI chat). Čistě prezentační: JSX přesunuto 1:1
// z GoalMapEditor (F1-07). Vstupy v balících:
//   mapa    … data mapy (id, název, uzly, hrany, členové, práva, pravidla)
//   access  … uživatel a oprávnění
//   node    … upravovaný uzel + handlery dialogu uzlu
//   dialogs … otevřeno/zavřeno jednotlivých dialogů + jejich handlery
//   ai      … AI chat
export default function EditorDialogs({ mapa, access, node, dialogs, ai }) {
  const {
    activeMapId, mapId, mapKind, title, nodes, edges, members, effectiveMapAccess,
    ownerOptions, isMapOwner, mapRules,
  } = mapa;
  const { user, canEdit, canWork, ctenarSPraci, isPublicView, bufferEnabled } = access;
  const {
    editNode, handleSaveNode, setEditNodeId, handleShareAdd, handleStashNode,
    setTaskStatsVersion, reloadMembers, setNodes, zrcadliStavDoZakladny, baseUpdated,
    openRulesFromNode, setMapRules,
  } = node;
  const {
    rulesOpen, rulesDefaults, setRulesOpen, handleEnableWaiting,
    taskNodeId, setTaskNodeId, saveTplOpen, setSaveTplOpen, skinOpen, setSkinOpen,
    shareOpen, setShareOpen, advisorOpen, setAdvisorOpen, handleAcceptAdvisor,
  } = dialogs;
  const { chatOpen, setChatOpen, handleApplyOperations, handleUndoAi, canUndoAi } = ai;
  return (
    <>
      <NodeEditDialog
        variant={canEdit ? 'full' : 'work'}
        orgMap={mapKind === 'org'}
        node={editNode}
        mapId={activeMapId || mapId}
        onSave={handleSaveNode}
        onClose={() => setEditNodeId(null)}
        mapAccess={effectiveMapAccess}
        // žádost o jiný termín: spolupracovník kdekoli, čtenář jen u své práce
        // (dialog se mu jinde ani neotevře — tužku má jen u svých kroků)
        canRequestDeadline={canWork || ctenarSPraci}
        members={members}
        onShareAdd={user && activeMapId ? handleShareAdd : undefined}
        onStash={bufferEnabled && canEdit ? handleStashNode : undefined}
        map={user && activeMapId && !isPublicView ? { id: activeMapId, title, nodes } : undefined}
        emailOptions={ownerOptions}
        onTasksChanged={() => setTaskStatsVersion((v) => v + 1)}
        onContactsChanged={reloadMembers}
        onWorkStatusSaved={(nodeId, next, updated) => {
          // zrcadlo handleCycleStatusWork: lokální stav + verze pro base_updated
          setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: next } } : n)));
          zrcadliStavDoZakladny(nodeId, next);
          if (updated) baseUpdated.current = updated;
        }}
        extraExecutorContent={canEdit && editNode && editNode.type !== 'apexNode' ? (
          <NodeRulesPanel rules={mapRules} nodeId={editNode.id} onOpenRules={openRulesFromNode} />
        ) : undefined}
        extraAssignmentContent={canEdit && user && activeMapId && !isPublicView && mapKind !== 'org' && editNode && editNode.type !== 'apexNode' ? (
          <RecurrenceSwitch
            mapId={activeMapId}
            nodeId={editNode.id}
            nodeTitle={editNode.data?.title || ''}
            rules={mapRules}
            onRulesChanged={setMapRules}
          />
        ) : undefined}
        extraBehaviorContent={canEdit && editNode && editNode.type !== 'apexNode' ? (
          <UnblockRulesHint rules={mapRules} nodeId={editNode.id} onOpenRules={openRulesFromNode} />
        ) : undefined}
      />
      {canEdit && user && activeMapId && !isPublicView && (
        <RulesDialog
          open={rulesOpen}
          mapId={activeMapId}
          nodes={nodes}
          edges={edges}
          members={members}
          mapAccess={effectiveMapAccess}
          onShareAdd={user && activeMapId ? handleShareAdd : undefined}
          onContactsChanged={reloadMembers}
          defaults={rulesDefaults}
          onClose={() => setRulesOpen(false)}
          onRulesChanged={setMapRules}
          onEnableWaiting={handleEnableWaiting}
        />
      )}
      {taskNodeId && activeMapId && (
        <NodeTasksDialog
          map={{ id: activeMapId, title, nodes }}
          nodeId={taskNodeId}
          canEdit={canEdit}
          members={members}
          onClose={() => setTaskNodeId(null)}
          onChanged={() => setTaskStatsVersion((v) => v + 1)}
        />
      )}
      <SaveTemplateDialog
        open={saveTplOpen}
        mapTitle={title}
        nodes={nodes}
        edges={edges}
        onClose={() => setSaveTplOpen(false)}
      />
      <SkinDialog open={skinOpen} onClose={() => setSkinOpen(false)} />
      <ShareDialog
        open={shareOpen}
        mapId={mapId}
        isOwner={isMapOwner}
        onClose={() => setShareOpen(false)}
        onMapBumped={(u) => { baseUpdated.current = u; }}
      />
      <AdvisorDialog
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        onAccept={handleAcceptAdvisor}
      />
      <AIChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        mapTitle={title}
        nodes={nodes}
        edges={edges}
        onApplyOperations={handleApplyOperations}
        onUndoAi={handleUndoAi}
        canUndoAi={canUndoAi}
      />
    </>
  );
}
