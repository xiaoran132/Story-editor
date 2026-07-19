package handler

import (
	"backend/internal/service"
	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type NodeHandler struct {
	svc *service.NodeService
}

func NewNodeHandler(svc *service.NodeService) *NodeHandler {
	return &NodeHandler{svc: svc}
}

func (h *NodeHandler) Create(c *gin.Context) {
	storyID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid story id"))
		return
	}

	var input service.NodeCreateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	// TODO: sessionID from path or context when play_sessions implemented
	node, err := h.svc.Create(storyID, uuid.Nil, &input)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Created(c, node)
}

func (h *NodeHandler) GetChildren(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid node id"))
		return
	}

	children, err := h.svc.GetChildren(nodeID)
	if err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.Success(c, children)
}

func (h *NodeHandler) Update(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid node id"))
		return
	}

	var input service.NodeCreateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		pkg.Error(c, pkg.BadRequest(err.Error()))
		return
	}

	node, err := h.svc.Update(nodeID, &input)
	if err != nil {
		pkg.Error(c, err)
		return
	}
	if node == nil {
		pkg.Error(c, pkg.NotFound("node not found"))
		return
	}

	pkg.Success(c, node)
}

func (h *NodeHandler) Delete(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		pkg.Error(c, pkg.BadRequest("invalid node id"))
		return
	}

	if err := h.svc.Delete(nodeID); err != nil {
		pkg.Error(c, err)
		return
	}

	pkg.NoContent(c)
}
