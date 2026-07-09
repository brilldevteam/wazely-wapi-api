const buildRetiredEmail = (email, userId) => {
  const [localPart, domainPart] = String(email).split('@');
  if (!localPart || !domainPart) {
    return `deleted-${userId}-${Date.now()}@deleted.local`;
  }

  return `${localPart}+deleted-${userId}@${domainPart}`;
};

export const retireUserEmail = (email, userId) => buildRetiredEmail(email, userId);

export const retireDeletedUsersWithEmail = async (UserModel, email) => {
  if (!email) return;

  const deletedUsers = await UserModel.find({
    email,
    deleted_at: { $ne: null },
  }).select('_id email');

  if (deletedUsers.length === 0) return;

  await UserModel.bulkWrite(
    deletedUsers.map((user) => ({
      updateOne: {
        filter: { _id: user._id },
        update: { $set: { email: retireUserEmail(user.email, user._id) } },
      },
    })),
  );
};
